/**
 * Per-file match fixes.
 *
 * A matched episode or movie can be corrected in the review table. The fix is
 * persisted on the library so a later scan keeps it, and the affected row is
 * re-planned through the same pure planner the backend uses.
 */

import type {
  MediaType,
  OrganizePlan,
  OrganizePlanItem,
  ParsedMediaName,
  TvdbEpisode,
  TvdbMovie,
} from './types';
import type { OrganizeMatchOverride, OrganizeSettings } from './settings';
import { buildOrganizePlan, type PlannedFileInput } from './planner';
import { parseMediaFilename } from './filename';
import { organizerComparisonKey, organizerIsPathInside } from './paths';

export function overrideKey(
  filePath: string,
  caseInsensitive: boolean,
): string {
  return organizerComparisonKey(filePath, { caseInsensitive });
}

export function overrideFor(
  settings: OrganizeSettings,
  filePath: string,
  caseInsensitive: boolean,
): OrganizeMatchOverride | undefined {
  return settings.overrides?.[overrideKey(filePath, caseInsensitive)];
}

export function setOverride(
  settings: OrganizeSettings,
  filePath: string,
  override: OrganizeMatchOverride,
  caseInsensitive: boolean,
): OrganizeSettings {
  const key = overrideKey(filePath, caseInsensitive);
  return {
    ...settings,
    overrides: { ...(settings.overrides ?? {}), [key]: override },
  };
}

export function clearOverride(
  settings: OrganizeSettings,
  filePath: string,
  caseInsensitive: boolean,
): OrganizeSettings {
  const key = overrideKey(filePath, caseInsensitive);
  const overrides = { ...(settings.overrides ?? {}) };
  delete overrides[key];
  return { ...settings, overrides };
}

function baseName(value: string): string {
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return separator < 0 ? value : value.slice(separator + 1);
}

function extensionOfName(value: string): string {
  return value.includes('.')
    ? value.slice(value.lastIndexOf('.') + 1).toLowerCase()
    : '';
}

function plannedInputFor(
  item: OrganizePlanItem,
  override: OrganizeMatchOverride | undefined,
): PlannedFileInput {
  const filename = baseName(item.sourcePath);
  const parsed: ParsedMediaName =
    item.parsed ?? parseMediaFilename(filename, item.sourceRelativePath);
  const episode: TvdbEpisode | undefined = override
    ? (override.episode ?? override.episodes?.[0])
    : (item.episode ?? item.episodes?.[0]);
  const episodes: TvdbEpisode[] | undefined = override
    ? override.episodes
    : item.episodes;
  const movie: TvdbMovie | undefined = override ? override.movie : item.movie;
  const seriesName = override?.series?.name ?? item.seriesName;
  const seriesYear = override?.series?.year ?? item.seriesYear;
  return {
    path: item.sourcePath,
    root: item.sourceRoot,
    relativePath: item.sourceRelativePath,
    filename,
    extension: extensionOfName(filename),
    size: 0,
    sidecars: item.sidecars.map((sidecar) => sidecar.sourcePath),
    parsed,
    confidence: override ? 1 : (item.confidence ?? 0),
    reason: override ? 'Manual match' : (item.reason ?? ''),
    ...(item.approved ? { approved: true } : {}),
    ...(item.renameFolderOnly ? { renameFolderOnly: true } : {}),
    ...(episode ? { episode } : {}),
    ...(episodes?.length ? { episodes } : {}),
    ...(movie ? { movie } : {}),
    ...(seriesName ? { seriesName } : {}),
    ...(seriesYear ? { seriesYear } : {}),
    ...(item.showFolder ? { showFolder: item.showFolder } : {}),
    ...(item.showSubpath !== undefined ? { showSubpath: item.showSubpath } : {}),
    ...(item.plex ? { plex: item.plex } : {}),
    ...(item.plexEpisodes?.length
      ? { plexEpisodes: item.plexEpisodes }
      : {}),
    ...(!override && item.episodeMatch
      ? { episodeMatch: item.episodeMatch }
      : {}),
  };
}

/**
 * Renders the target path for a prospective manual match without touching the
 * plan. Used by the Fix match modal to preview the new filename.
 */
export function previewTargetForItem(
  item: OrganizePlanItem,
  override: OrganizeMatchOverride,
  options: {
    settings: OrganizeSettings;
    mediaType: MediaType;
    caseInsensitive?: boolean;
  },
): string | undefined {
  const replanned = buildOrganizePlan({
    mediaType: options.mediaType,
    sourceRoots: [item.sourceRoot],
    files: [plannedInputFor(item, override)],
    rules: options.settings.namingRules,
    confidenceThreshold: 0,
    renameMovieFolders: options.settings.renameMovieFolders,
    caseInsensitive:
      options.caseInsensitive ?? options.settings.caseInsensitive ?? false,
    collisions: 'suffix',
    sidecarPolicy: 'skip',
    existingPaths: [],
  });
  return replanned.items[0]?.targetPath;
}

/**
 * Re-plans a single row after a manual match change. Other rows keep their
 * current targets so collisions are still reported.
 */
export function applyPlanOverride(
  plan: OrganizePlan,
  itemId: string,
  override: OrganizeMatchOverride | undefined,
  options: {
    settings: OrganizeSettings;
    mediaType: MediaType;
    caseInsensitive?: boolean;
  },
): OrganizePlan {
  const item = plan.items.find((candidate) => candidate.id === itemId);
  if (!item) return plan;
  const existingPaths = plan.items
    .filter((candidate) => candidate.id !== item.id)
    .flatMap((candidate) => [
      candidate.sourcePath,
      candidate.targetPath,
      ...candidate.sidecars.map((sidecar) => sidecar.targetPath),
    ]);
  const replanned = buildOrganizePlan({
    mediaType: options.mediaType,
    sourceRoots: plan.sourceRoots,
    files: [plannedInputFor(item, override)],
    rules: options.settings.namingRules,
    confidenceThreshold: 0,
    renameMovieFolders: options.settings.renameMovieFolders,
    caseInsensitive:
      options.caseInsensitive ?? options.settings.caseInsensitive ?? false,
    collisions: options.settings.collisions,
    sidecarPolicy: options.settings.sidecars,
    existingPaths,
  });
  const next = replanned.items[0];
  if (!next) return plan;
  return {
    ...plan,
    items: plan.items.map((candidate) =>
      candidate.id === item.id
        ? item.manualSkip
          ? {
              ...next,
              id: item.id,
              action: 'skip',
              reason: 'Skipped manually',
              manualSkip: true,
            }
          : { ...next, id: item.id }
        : candidate,
    ),
  };
}

interface ReplanOptions {
  settings: OrganizeSettings;
  mediaType: MediaType;
  caseInsensitive?: boolean;
}

const PLANNER_WARNING =
  /(have no selected TVDB series\.|have conflicting tag\/title evidence; review them before applying\.|are below the confidence threshold\.|target path conflict\(s\) must be resolved\.)$/;

function mergePlanWarnings(existing: string[], next: string[]): string[] {
  return [
    ...new Set([...existing.filter((warning) => !PLANNER_WARNING.test(warning)), ...next]),
  ];
}

/**
 * Rebuilds every target from the plan's cached match data. Used when naming or
 * plan settings change without rescanning or re-matching.
 */
export function replanPlan(
  plan: OrganizePlan,
  options: ReplanOptions,
): OrganizePlan {
  return rebuildPlan(
    plan,
    options,
    plan.items.filter((item) => item.manualSkip).map((item) => item.id),
  );
}

/** Rebuilds the plan with a new set of manually skipped item ids. */
export function applyPlanSkips(
  plan: OrganizePlan,
  skippedIds: Iterable<string>,
  options: ReplanOptions,
): OrganizePlan {
  return rebuildPlan(plan, options, skippedIds);
}

/**
 * Uses each row's own top-ranked match: the confidence threshold is ignored
 * and any skip is dropped, so a low-scoring or conflicting match becomes a
 * rename the user can review before applying.
 */
export function applyPlanBestGuess(
  plan: OrganizePlan,
  itemIds: Iterable<string>,
  options: ReplanOptions,
): OrganizePlan {
  const ids = new Set(itemIds);
  if (ids.size === 0) return plan;
  const caseInsensitive =
    options.caseInsensitive ?? options.settings.caseInsensitive ?? false;
  const existingPaths = plan.items
    .filter((item) => !ids.has(item.id))
    .flatMap((item) => [
      item.sourcePath,
      item.targetPath,
      ...item.sidecars.map((sidecar) => sidecar.targetPath),
    ]);

  const replacements = new Map<string, OrganizePlanItem>();
  for (const item of plan.items) {
    if (!ids.has(item.id)) continue;
    // Without a match there is no guess to promote; leave the row as it is.
    if (!item.episode && !item.episodes?.length && !item.movie) continue;
    const replanned = buildOrganizePlan({
      mediaType: options.mediaType,
      sourceRoots: plan.sourceRoots,
      files: [plannedInputFor(item, undefined)],
      rules: options.settings.namingRules,
      // The user asked for this row's best match regardless of the score.
      confidenceThreshold: 0,
      renameMovieFolders: options.settings.renameMovieFolders,
      caseInsensitive,
      collisions: options.settings.collisions,
      sidecarPolicy: options.settings.sidecars,
      existingPaths,
    });
    const next = replanned.items[0];
    if (!next) continue;
    const promoted = item.action !== 'rename' && next.action === 'rename';
    replacements.set(item.id, {
      ...next,
      id: item.id,
      // An explicit best guess survives later replans like an approval.
      ...(next.action === 'rename' ? { approved: true } : {}),
      ...(promoted
        ? {
            reason: `Best guess (${Math.round((item.confidence ?? 0) * 100)}% confidence)`,
          }
        : {}),
    });
  }
  if (replacements.size === 0) return plan;
  return {
    ...plan,
    items: plan.items.map((item) => replacements.get(item.id) ?? item),
  };
}

/**
 * Approves rows so a later replan keeps them as renames even when their
 * confidence is below the threshold. Approving also re-includes a row the user
 * skipped earlier, just like saving its match does.
 */
export function approvePlanItems(
  plan: OrganizePlan,
  itemIds: Iterable<string>,
  options: ReplanOptions,
): OrganizePlan {
  const ids = new Set(itemIds);
  if (ids.size === 0) return plan;
  let changed = false;
  const approved = plan.items.map((item) => {
    if (!ids.has(item.id)) return item;
    if (item.approved && !item.manualSkip) return item;
    changed = true;
    return { ...item, approved: true as const, manualSkip: undefined };
  });
  if (!changed) return plan;
  return rebuildPlan(
    { ...plan, items: approved },
    options,
    approved
      .filter((item) => item.manualSkip)
      .map((item) => item.id),
  );
}

/**
 * Marks rows to keep their current file name while still applying the rendered
 * folder, or restores the template file name when `folderOnly` is false.
 */
export function setPlanFolderOnly(
  plan: OrganizePlan,
  itemIds: Iterable<string>,
  folderOnly: boolean,
  options: ReplanOptions,
): OrganizePlan {
  const ids = new Set(itemIds);
  if (ids.size === 0) return plan;
  let changed = false;
  const items = plan.items.map((item) => {
    if (!ids.has(item.id)) return item;
    if (Boolean(item.renameFolderOnly) === folderOnly) return item;
    changed = true;
    return folderOnly
      ? { ...item, renameFolderOnly: true as const }
      : { ...item, renameFolderOnly: undefined };
  });
  if (!changed) return plan;
  return rebuildPlan(
    { ...plan, items },
    options,
    items.filter((item) => item.manualSkip).map((item) => item.id),
  );
}

/**
 * Carries the review-only row decisions (approval and folder-only) onto a
 * freshly matched plan after a rescan or recalculation.
 */
export function carryPlanRowFlags(
  previous: OrganizePlan,
  next: OrganizePlan,
  options: ReplanOptions,
): OrganizePlan {
  if (previous.items.length === 0) return next;
  const byId = new Map(previous.items.map((item) => [item.id, item]));
  let changed = false;
  const items = next.items.map((item) => {
    const before = byId.get(item.id);
    if (!before) return item;
    const merged = {
      ...item,
      ...(before.approved ? { approved: true as const } : {}),
      ...(before.renameFolderOnly ? { renameFolderOnly: true as const } : {}),
    };
    if (
      merged.approved === item.approved &&
      merged.renameFolderOnly === item.renameFolderOnly
    ) {
      return item;
    }
    changed = true;
    return merged;
  });
  if (!changed) return next;
  return rebuildPlan(
    { ...next, items },
    options,
    items.filter((item) => item.manualSkip).map((item) => item.id),
  );
}

function rebuildPlan(
  plan: OrganizePlan,
  options: ReplanOptions,
  skippedIds: Iterable<string>,
): OrganizePlan {
  const caseInsensitive =
    options.caseInsensitive ?? options.settings.caseInsensitive ?? false;
  const files = plan.items.map((item) => plannedInputFor(item, undefined));
  const existingPaths = plan.items.flatMap((item) => [
    item.sourcePath,
    ...item.sidecars.map((sidecar) => sidecar.sourcePath),
  ]);
  const replanned = buildOrganizePlan({
    mediaType: options.mediaType,
    sourceRoots: plan.sourceRoots,
    files,
    rules: options.settings.namingRules,
    confidenceThreshold: options.settings.confidenceThreshold,
    renameMovieFolders: options.settings.renameMovieFolders,
    caseInsensitive,
    collisions: options.settings.collisions,
    sidecarPolicy: options.settings.sidecars,
    existingPaths,
    skippedPaths: [...skippedIds],
  });
  const byId = new Map(replanned.items.map((item) => [item.id, item]));
  return {
    ...plan,
    items: plan.items.map((item) => byId.get(item.id) ?? item),
    warnings: mergePlanWarnings(plan.warnings, replanned.warnings),
  };
}

/**
 * Splices a fresh scan of `folders` into the review. Rows under those folders
 * are replaced with the new results (files that disappeared are dropped and
 * newly discovered files are appended), while every other row is untouched.
 */
export function mergeRescannedPlan(
  plan: OrganizePlan,
  rescanned: OrganizePlan,
  folders: Iterable<string>,
  options: ReplanOptions,
): OrganizePlan {
  const caseInsensitive =
    options.caseInsensitive ?? options.settings.caseInsensitive ?? false;
  const roots = [...folders].filter(Boolean);
  if (roots.length === 0) return plan;
  const inside = (value: string) =>
    roots.some((root) =>
      organizerIsPathInside(value, root, { caseInsensitive }),
    );
  const skipped = new Set(
    plan.items
      .filter((item) => item.manualSkip && inside(item.sourcePath))
      .map((item) => item.id),
  );
  const fresh = applyPlanSkips(rescanned, skipped, options);
  const byId = new Map(fresh.items.map((item) => [item.id, item]));
  const items: OrganizePlanItem[] = [];
  for (const item of plan.items) {
    if (!inside(item.sourcePath)) {
      items.push(item);
      continue;
    }
    const next = byId.get(item.id);
    if (!next) continue;
    items.push(next);
    byId.delete(item.id);
  }
  items.push(...byId.values());
  const merged: OrganizePlan = {
    ...plan,
    items,
    warnings: mergePlanWarnings(plan.warnings, fresh.warnings),
  };
  // Row decisions are per review, so carry them onto the freshly matched rows.
  return carryPlanRowFlags(plan, merged, options);
}
