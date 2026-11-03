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
import { organizerComparisonKey } from './paths';

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
    ? override.episode
    : item.episode;
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
    parsed,
    confidence: override ? 1 : (item.confidence ?? 0),
    reason: override ? 'Manual match' : (item.reason ?? ''),
    ...(episode ? { episode } : {}),
    ...(movie ? { movie } : {}),
    ...(seriesName ? { seriesName } : {}),
    ...(seriesYear ? { seriesYear } : {}),
    ...(item.showFolder ? { showFolder: item.showFolder } : {}),
    ...(item.showSubpath !== undefined ? { showSubpath: item.showSubpath } : {}),
    ...(item.plex ? { plex: item.plex } : {}),
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
      candidate.id === item.id ? { ...next, id: item.id } : candidate,
    ),
  };
}
