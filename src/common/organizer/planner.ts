import type {
  MediaType,
  OrganizePlan,
  OrganizePlanItem,
  OrganizeSidecar,
  OrganizeSourceFile,
  ParsedMediaName,
  PlexAssociation,
  TvdbEpisode,
  TvdbMovie,
} from './types';
import type { NamingRule } from './settings';
import {
  extensionOf,
  stripExtension,
  episodeTag,
} from './filename';
import { selectNamingRule, type NamingRuleContext } from './rules';
import {
  isCaseOnlyDifference,
  joinPathLike,
  joinRelativeSegments,
  organizerComparisonKey,
  relativeDirSegments,
  renderFileTemplate,
  renderFolderTemplate,
  renderTemplate,
  sanitizePathSegment,
  splitFolderTemplate,
  type TemplateTokens,
} from './paths';

export interface PlannedFileInput extends OrganizeSourceFile {
  parsed: ParsedMediaName;
  confidence: number;
  reason: string;
  episode?: TvdbEpisode;
  movie?: TvdbMovie;
  plex?: PlexAssociation;
  seriesName?: string;
  /** First-release year of the matched series. */
  seriesYear?: number;
  /** Show folder name for display. */
  showFolder?: string;
  /** Show folder relative to the root; `''` means the root is the show. */
  showSubpath?: string;
}

export interface OrganizePlanInput {
  mediaType: MediaType;
  sourceRoots: string[];
  files: PlannedFileInput[];
  rules: NamingRule[];
  confidenceThreshold: number;
  renameMovieFolders: boolean;
  caseInsensitive: boolean;
  collisions: 'block' | 'suffix';
  sidecarPolicy: 'rename' | 'skip';
  /** Paths discovered on disk, used to flag targets that already exist. */
  existingPaths?: string[];
}

function tokensFor(
  file: PlannedFileInput,
  mediaType: MediaType,
): TemplateTokens {
  const episode = file.episode;
  const movie = file.movie;
  const airYear =
    episode?.airDate && /^\d{4}/.test(episode.airDate)
      ? Number(episode.airDate.slice(0, 4))
      : undefined;
  return {
    ext: file.extension,
    filename: file.filename,
    path: file.path,
    mediaType,
    resolution: file.parsed.resolution ?? '',
    season: episode?.seasonNumber,
    episode: episode?.episodeNumber,
    tag:
      episode?.tag ||
      (episode ? episodeTag(episode.seasonNumber, episode.episodeNumber) : ''),
    name: episode?.name ?? '',
    show: file.seriesName ?? '',
    title: movie?.title ?? episode?.name ?? file.parsed.title,
    year: movie?.year ?? airYear ?? file.parsed.year,
    seriesYear: file.seriesYear,
    slug: movie?.slug ?? '',
    imdbId: movie?.imdbId ?? '',
    tmdbId: movie?.tmdbId ?? '',
  };
}

function ruleContextFor(
  file: PlannedFileInput,
  mediaType: MediaType,
): NamingRuleContext {
  return {
    mediaType,
    path: file.path,
    filename: file.filename,
    extension: file.extension,
    resolution: file.parsed.resolution,
    seasonNumber: file.episode?.seasonNumber ?? file.parsed.seasonNumber,
    episodeNumber: file.episode?.episodeNumber ?? file.parsed.episodeNumber,
    title: file.movie?.title ?? file.episode?.name ?? file.parsed.title,
    year: file.movie?.year ?? file.parsed.year,
  };
}

function ensureExtension(filename: string, extension: string): string {
  if (!extension) return filename;
  if (extensionOf(filename)) return filename;
  return `${filename}.${extension}`;
}

/**
 * Renders the folder template for a TV file. When the show folder *is* the
 * library root, segments that reference `{show}` are dropped so a single-show
 * library keeps its `root/Season NN/file` layout instead of nesting a second
 * show folder.
 */
function tvFolderSegments(
  template: string,
  tokens: TemplateTokens,
  rootIsShow: boolean,
): string[] {
  if (!rootIsShow) return renderFolderTemplate(template, tokens);
  return splitFolderTemplate(template)
    .filter((segment) => !segment.includes('{show}'))
    .map((segment) => sanitizePathSegment(renderTemplate(segment, tokens)))
    .filter((segment) => segment.length > 0);
}

function sidecarTargets(
  file: PlannedFileInput,
  targetFilename: string,
  targetDirectory: string,
  separator: string,
): OrganizeSidecar[] {
  const videoBase = stripExtension(file.filename);
  return (file.sidecars ?? []).flatMap((sidecarPath) => {
    const separatorIndex = Math.max(
      sidecarPath.lastIndexOf('/'),
      sidecarPath.lastIndexOf('\\'),
    );
    const sidecarName = sidecarPath.slice(separatorIndex + 1);
    const sidecarExtension = extensionOf(sidecarName);
    const sidecarBase = stripExtension(sidecarName);
    const suffix = sidecarBase.toLowerCase().startsWith(videoBase.toLowerCase())
      ? sidecarBase.slice(videoBase.length)
      : '';
    const safeSuffix = sanitizePathSegment(suffix);
    const newBase = stripExtension(targetFilename);
    const newName = sanitizePathSegment(
      `${newBase}${safeSuffix}.${sidecarExtension}`,
    );
    if (!newName) return [];
    return [
      {
        sourcePath: sidecarPath,
        targetPath: `${targetDirectory}${separator}${newName}`,
      },
    ];
  });
}

function uniqueTarget(
  candidate: string,
  used: Set<string>,
  caseInsensitive: boolean,
): string {
  const separatorIndex = Math.max(
    candidate.lastIndexOf('/'),
    candidate.lastIndexOf('\\'),
  );
  const directory = candidate.slice(0, separatorIndex + 1);
  const name = candidate.slice(separatorIndex + 1);
  const extension = extensionOf(name);
  const base = stripExtension(name);
  let suffix = 2;
  let current = candidate;
  while (
    used.has(organizerComparisonKey(current, { caseInsensitive }))
  ) {
    current = `${directory}${base} (${suffix})${extension ? `.${extension}` : ''}`;
    suffix += 1;
  }
  return current;
}

/**
 * Pure plan builder shared by the backend and the review UI. It never touches
 * the filesystem; callers supply discovered paths and Plex associations.
 */
export function buildOrganizePlan(input: OrganizePlanInput): OrganizePlan {
  const warnings: string[] = [];
  const used = new Set<string>(
    (input.existingPaths ?? []).map((path) =>
      organizerComparisonKey(path, { caseInsensitive: input.caseInsensitive }),
    ),
  );
  const sourceKeys = new Set(
    input.files.map((file) =>
      organizerComparisonKey(file.path, {
        caseInsensitive: input.caseInsensitive,
      }),
    ),
  );
  const items: OrganizePlanItem[] = [];

  for (const file of input.files) {
    const rule = selectNamingRule(input.rules, ruleContextFor(file, input.mediaType));
    const fallbackTarget = file.path;
    const fallbackRelative = file.relativePath;
    const showFolderName =
      file.showFolder ??
      (file.showSubpath
        ? file.showSubpath.split(/[\\/]+/).filter(Boolean).pop()
        : undefined);
    const base: Omit<OrganizePlanItem, 'targetPath' | 'relativeTarget' | 'sidecars'> = {
      id: file.path,
      mediaType: input.mediaType,
      sourcePath: file.path,
      sourceRoot: file.root,
      sourceRelativePath: file.relativePath,
      action: 'skip',
      confidence: file.confidence,
      reason: file.reason,
      parsed: file.parsed,
      ...(rule ? { ruleId: rule.id } : {}),
      ...(file.episode ? { episode: file.episode } : {}),
      ...(file.movie ? { movie: file.movie } : {}),
      ...(file.plex ? { plex: file.plex } : {}),
      ...(file.seriesName ? { seriesName: file.seriesName } : {}),
      ...(file.seriesYear ? { seriesYear: file.seriesYear } : {}),
      ...(showFolderName ? { showFolder: showFolderName } : {}),
      ...(file.showSubpath !== undefined
        ? { showSubpath: file.showSubpath }
        : {}),
    };

    if (file.confidence < input.confidenceThreshold) {
      items.push({
        ...base,
        action: 'skip',
        reason:
          file.reason ||
          `Confidence ${(file.confidence * 100).toFixed(0)}% is below the ${(
            input.confidenceThreshold * 100
          ).toFixed(0)}% threshold`,
        targetPath: fallbackTarget,
        relativeTarget: fallbackRelative,
        sidecars: [],
      });
      continue;
    }

    if (!rule) {
      items.push({
        ...base,
        action: 'skip',
        reason: 'No naming rule is available',
        targetPath: fallbackTarget,
        relativeTarget: fallbackRelative,
        sidecars: [],
      });
      continue;
    }

    let targetFilename: string;
    let folderSegments: string[];
    try {
      const tokens = tokensFor(file, input.mediaType);
      targetFilename = ensureExtension(
        renderFileTemplate(rule.fileTemplate, tokens),
        file.extension,
      );
      folderSegments = rule.folderTemplate.trim()
        ? input.mediaType === 'tv'
          ? tvFolderSegments(
              rule.folderTemplate,
              tokens,
              file.showSubpath === '',
            )
          : renderFolderTemplate(rule.folderTemplate, tokens)
        : [];
    } catch (error) {
      items.push({
        ...base,
        action: 'skip',
        reason: error instanceof Error ? error.message : String(error),
        targetPath: fallbackTarget,
        relativeTarget: fallbackRelative,
        sidecars: [],
      });
      continue;
    }

    let relativeSegments: string[];
    if (input.mediaType === 'tv') {
      relativeSegments = [...folderSegments, targetFilename];
    } else if (!input.renameMovieFolders) {
      relativeSegments = [...relativeDirSegments(file.relativePath), targetFilename];
    } else {
      const dirSegments = relativeDirSegments(file.relativePath);
      // Preserve a collection folder when the file sits in <collection>/<movie>/.
      const collectionSegments =
        dirSegments.length >= 2 ? dirSegments.slice(0, -1) : [];
      relativeSegments = [...collectionSegments, ...folderSegments, targetFilename];
    }

    const relativeTarget = joinRelativeSegments(relativeSegments);
    let targetPath = joinPathLike(file.root, ...relativeSegments);
    const separator = targetPath.includes('\\') && !targetPath.includes('/') ? '\\' : '/';
    const targetKey = organizerComparisonKey(targetPath, {
      caseInsensitive: input.caseInsensitive,
    });
    const sourceKey = organizerComparisonKey(file.path, {
      caseInsensitive: input.caseInsensitive,
    });
    const caseOnly = isCaseOnlyDifference(file.path, targetPath, {
      caseInsensitive: input.caseInsensitive,
    });

    let action: OrganizePlanItem['action'] = 'rename';
    let reason = file.reason || 'Matched';
    if (targetKey === sourceKey) {
      action = 'skip';
      reason = 'Already named';
    } else if (used.has(targetKey) && !sourceKeys.has(targetKey)) {
      if (input.collisions === 'suffix') {
        targetPath = uniqueTarget(targetPath, used, input.caseInsensitive);
        reason = `${file.reason || 'Matched'} (collision renamed)`;
      } else {
        action = 'conflict';
        reason = 'Target already exists';
      }
    }

    const sidecars =
      action === 'rename' && input.sidecarPolicy === 'rename'
        ? sidecarTargets(
            file,
            targetPath.slice(
              Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\')) + 1,
            ),
            targetPath.slice(
              0,
              Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\')),
            ),
            separator,
          )
        : [];

    used.add(
      organizerComparisonKey(targetPath, {
        caseInsensitive: input.caseInsensitive,
      }),
    );
    items.push({
      ...base,
      action,
      reason,
      targetPath,
      relativeTarget,
      sidecars,
      ...(caseOnly ? { caseOnly: true } : {}),
    });
  }

  if (input.mediaType === 'tv') {
    const withoutSeries = input.files.filter((file) => !file.seriesName);
    if (withoutSeries.length > 0) {
      warnings.push(
        `${withoutSeries.length} TV file(s) have no selected TVDB series.`,
      );
    }
  }
  const lowConfidence = input.files.filter(
    (file) => file.confidence < input.confidenceThreshold,
  ).length;
  if (lowConfidence > 0) {
    warnings.push(`${lowConfidence} file(s) are below the confidence threshold.`);
  }
  const conflicts = items.filter((item) => item.action === 'conflict').length;
  if (conflicts > 0) warnings.push(`${conflicts} target path conflict(s) must be resolved.`);

  return {
    mediaType: input.mediaType,
    sourceRoots: input.sourceRoots,
    items,
    createdAt: new Date().toISOString(),
    warnings,
  };
}
