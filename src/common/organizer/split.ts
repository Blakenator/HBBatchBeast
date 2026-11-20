import type {
  MediaType,
  OrganizePlanItem,
  PlexAssociation,
  TvdbEpisode,
} from './types';
import type { OrganizeSettings } from './settings';
import { organizerComparisonKey, sanitizePathSegment } from './paths';
import { previewTargetForItem } from './overrides';

/** How segment boundaries are cut from the source file. */
export type SplitCutMode = 'copy' | 'exact';

/** What happens to the multi-episode source once every segment succeeded. */
export type SplitOriginalPolicy = 'backup' | 'delete' | 'keep';

/** How external subtitle sidecars of the source are treated. */
export type SplitSidecarPolicy = 'leave' | 'split' | 'copy';

export type SplitEstimateMethod =
  | 'tvdb'
  | 'plex'
  | 'mixed'
  | 'equal'
  | 'manual';

export interface SplitSegment {
  /** 0-based order in the file. */
  index: number;
  startSeconds: number;
  endSeconds: number;
  /** Episode this segment becomes; `undefined` only while editing. */
  episode?: TvdbEpisode;
  /** Keyframe start actually used by copy mode; equals start for exact cuts. */
  cutSeconds?: number;
  /** Rendered target, computed from the naming rules. */
  targetPath?: string;
  /** Manual filename override; the folder still comes from the naming rules. */
  outputName?: string;
}

/** Why a rendered split target cannot be written as planned. */
export type SplitTargetConflictKind =
  | 'source'
  | 'planned'
  | 'duplicate'
  | 'exists'
  | 'missing';

export interface SplitTargetConflict {
  /** `SplitSegment.index` of the segment whose target conflicts. */
  segmentIndex: number;
  targetPath?: string;
  kind: SplitTargetConflictKind;
  message: string;
  /** Only a file already on disk can be replaced by the overwrite option. */
  overwriteable: boolean;
}

export interface SplitTargetReport {
  targets: (string | undefined)[];
  /** Targets before any manual filename override, used for placeholders. */
  defaultTargets?: (string | undefined)[];
  /** Flat messages kept for the existing problem lists and tests. */
  conflicts: string[];
  targetConflicts: SplitTargetConflict[];
}

export interface SplitTargetOptions {
  settings: OrganizeSettings;
  mediaType: MediaType;
  caseInsensitive?: boolean;
  /** Paths that already exist on disk and therefore cannot be reused. */
  existingPaths?: string[];
  /** Paths other plan rows or split segments already claim. */
  reservedPaths?: string[];
  /** Segment indexes that will not be written, so they never conflict. */
  skippedSegments?: number[];
}

/** A run of black video reported by ffmpeg's `blackdetect` filter. */
export interface SplitBlackInterval {
  startSeconds: number;
  endSeconds: number;
}

/** The middle of a black run, which is the safest divider to cut on. */
export function blackDividerSeconds(interval: SplitBlackInterval): number {
  return roundSeconds(
    interval.startSeconds + (interval.endSeconds - interval.startSeconds) / 2,
  );
}

/**
 * Estimates the seconds left for a batch black-frame scan from the share of
 * the total video duration already decoded. Returns `undefined` until there is
 * a measurable rate.
 */
export function blackBatchEtaSeconds(
  totalSeconds: number,
  doneSeconds: number,
  elapsedSeconds: number,
): number | undefined {
  if (!(totalSeconds > 0) || !(doneSeconds > 0) || !(elapsedSeconds > 0)) {
    return undefined;
  }
  if (doneSeconds >= totalSeconds) return 0;
  return (elapsedSeconds * (totalSeconds - doneSeconds)) / doneSeconds;
}

/**
 * Finds the nearest black divider to a proposed cut. Returns `undefined` when
 * every divider is farther away than the caller's tolerance.
 */
export function nearestBlackDivider(
  intervals: readonly SplitBlackInterval[],
  seconds: number,
  maxDistanceSeconds = 60,
): number | undefined {
  let best: number | undefined;
  let bestDistance = maxDistanceSeconds;
  for (const interval of intervals) {
    if (interval.endSeconds <= interval.startSeconds) continue;
    const divider = blackDividerSeconds(interval);
    const distance = Math.abs(divider - seconds);
    if (distance <= bestDistance) {
      best = divider;
      bestDistance = distance;
    }
  }
  return best;
}

/** One cut per detected black run, optionally ignoring very short flashes. */
export function blackDividerCuts(
  intervals: readonly SplitBlackInterval[],
  minDurationSeconds = 0.3,
): number[] {
  return intervals
    .filter(
      (interval) =>
        interval.endSeconds - interval.startSeconds >= minDurationSeconds,
    )
    .map(blackDividerSeconds)
    .sort((left, right) => left - right);
}

export type SplitProbeStreamType =
  | 'video'
  | 'audio'
  | 'subtitle'
  | 'attachment'
  | 'other';

export interface SplitProbeStream {
  index: number;
  type: SplitProbeStreamType;
  codec?: string;
  width?: number;
  height?: number;
  channels?: number;
  language?: string;
  title?: string;
}

/** Probe data the split editor and apply need. */
export interface OrganizeSplitProbe {
  path: string;
  size: number;
  durationSeconds: number;
  /**
   * PTS of the first frame. ffprobe reports absolute keyframe timestamps that
   * include this offset; the editor and the segment muxer both work relative
   * to the start of the file, so the probe subtracts it.
   */
  startTimeSeconds: number;
  formatName?: string;
  width?: number;
  height?: number;
  videoCodecs: string[];
  audioCodecs: string[];
  subtitleCodecs: string[];
  streams: SplitProbeStream[];
  /** Present when the request asked for keyframes near specific markers. */
  keyframes?: SplitKeyframeCut[];
}

export interface SplitKeyframeCut {
  requestedSeconds: number;
  /** Undefined when no keyframe could be found inside the window. */
  keyframeSeconds?: number;
  deltaSeconds?: number;
  /** Every keyframe inside the probe window, sorted; copy mode offers these. */
  candidates?: number[];
}

/**
 * Picks the keyframe alternatives nearest a cut. The editor shows a handful so
 * the strip stays readable even when a file has many keyframes per second.
 */
export function nearestSplitCandidates(
  candidates: readonly number[],
  target: number,
  limit = 5,
): number[] {
  return [...new Set(candidates)]
    .filter(
      (seconds) =>
        Number.isFinite(seconds) && Math.abs(seconds - target) > 0.001,
    )
    .sort(
      (left, right) =>
        Math.abs(left - target) - Math.abs(right - target) || left - right,
    )
    .slice(0, Math.max(0, limit));
}

export interface OrganizeSplitThumbnailFrame {
  seconds: number;
  dataUrl: string;
}

/** Result of resolving ffmpeg for the split editor. */
export interface SplitFfmpegStatus {
  available: boolean;
  path: string;
  version?: string;
  source: 'configured' | 'bundled' | 'path';
}

/** Progress from the black-frame scan that powers the split divider tools. */
export interface OrganizeBlackScanProgress {
  /** 0–100; stays below 100 until ffmpeg finishes. */
  percent: number;
}

/**
 * One queued split. Stored on the review session (not in the library settings)
 * and passed to apply next to the plan.
 */
export interface OrganizeSplitPlan {
  /** `OrganizePlanItem.id`, which is the source path today. */
  itemId: string;
  sourcePath: string;
  /** Fingerprint used to reject a plan recorded against another file. */
  fileSize: number;
  fileDurationSeconds: number;
  /** Expected runtime per episode, in order; `undefined` when unavailable. */
  episodeDurationsSeconds?: (number | undefined)[];
  estimate: {
    method: SplitEstimateMethod;
    /** fileDuration − sum(episode durations); positive is unused tail. */
    slackSeconds?: number;
    note?: string;
  };
  cutMode: SplitCutMode;
  originalPolicy: SplitOriginalPolicy;
  sidecarPolicy: SplitSidecarPolicy;
  segments: SplitSegment[];
  /** Replace files that already exist at a rendered target. */
  overwrite?: boolean;
  /**
   * Segment indexes that are intentionally not written. Used when the target
   * already exists or another file already covers that episode; the segment
   * stays in the plan so its time range, order and episode stay stable.
   */
  skippedSegments?: number[];
  /** True when the user moved a boundary by hand. */
  edited?: boolean;
  updatedAt: number;
}

export interface SplitBoundaryEstimate {
  /** `episodes.length + 1` values, starting at 0 and ending at the duration. */
  boundaries: number[];
  method: Exclude<SplitEstimateMethod, 'manual'>;
  slackSeconds: number;
  note?: string;
}

const MIN_SEGMENT_SECONDS = 2;

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function equalBoundaries(duration: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, index) =>
    roundSeconds((duration * index) / count),
  );
}

function monotonic(boundaries: number[]): boolean {
  if (boundaries.length < 2) return false;
  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index] <= boundaries[index - 1]) return false;
  }
  return true;
}

/**
 * Turns episode runtimes into cut points. The leftover (`file duration − sum of
 * episode runtimes`, usually intros/credits/branding) is spread evenly across
 * the boundaries, which is the closest estimate without decoding the file.
 */
export function estimateSplitBoundaries(input: {
  fileDurationSeconds: number;
  episodeDurationsSeconds?: (number | undefined)[];
}): SplitBoundaryEstimate {
  const duration = positive(input.fileDurationSeconds);
  const durations = input.episodeDurationsSeconds ?? [];
  const count = durations.length;
  if (!duration || count < 1) {
    return { boundaries: [], method: 'equal', slackSeconds: 0 };
  }
  if (count === 1) {
    return {
      boundaries: [0, roundSeconds(duration)],
      method: 'equal',
      slackSeconds: 0,
    };
  }

  const known = durations.map((value) => positive(value));
  const knownCount = known.filter((value) => value !== undefined).length;
  if (knownCount === 0) {
    return {
      boundaries: equalBoundaries(duration, count),
      method: 'equal',
      slackSeconds: 0,
      note: 'No episode runtimes were available; the file was divided evenly.',
    };
  }

  const method: SplitBoundaryEstimate['method'] =
    knownCount === count ? 'tvdb' : knownCount === 0 ? 'equal' : 'mixed';
  const knownSum = known.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const missingCount = count - knownCount;
  const perMissing =
    missingCount > 0 ? (duration - knownSum) / missingCount : undefined;
  const effective =
    perMissing !== undefined && perMissing > 0
      ? known.map((value) => value ?? perMissing)
      : known;
  const effectiveSum = effective.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  if (!(effectiveSum > 0)) {
    return {
      boundaries: equalBoundaries(duration, count),
      method: 'equal',
      slackSeconds: 0,
      note: 'Episode runtimes were unusable; the file was divided evenly.',
    };
  }

  const slack = duration - effectiveSum;
  const boundaries = [0];
  let cumulative = 0;
  for (let index = 0; index < count; index += 1) {
    const value = effective[index];
    if (value === undefined) {
      // Unknown durations: divide whatever time is left over.
      const remaining = duration - cumulative;
      const remainingCount = count - index;
      cumulative += remaining / remainingCount;
    } else if (slack >= 0) {
      cumulative += value + slack / count;
    } else {
      cumulative += value;
    }
    boundaries.push(roundSeconds(cumulative));
  }
  boundaries[boundaries.length - 1] = roundSeconds(duration);

  if (slack >= 0 && monotonic(boundaries)) {
    return {
      boundaries,
      method,
      slackSeconds: roundSeconds(slack),
      ...(method === 'mixed'
        ? {
            note: `${missingCount} episode runtime(s) were unavailable and shared the leftover time.`,
          }
        : {}),
    };
  }

  // The file is shorter than the summed runtimes (credits trimmed, different
  // edit, bad metadata). Scaling keeps every segment proportional.
  const scaled = [0];
  let scaledCumulative = 0;
  for (const value of effective) {
    scaledCumulative += value ?? 0;
    scaled.push(roundSeconds((scaledCumulative / effectiveSum) * duration));
  }
  scaled[scaled.length - 1] = roundSeconds(duration);
  if (monotonic(scaled)) {
    return {
      boundaries: scaled,
      method,
      slackSeconds: roundSeconds(slack),
      note: 'Episode runtimes are longer than the file, so the cuts were scaled proportionally.',
    };
  }
  return {
    boundaries: equalBoundaries(duration, count),
    method: 'equal',
    slackSeconds: 0,
    note: 'Cut estimates could not be ordered; the file was divided evenly.',
  };
}

/** Builds ordered segments from full boundaries and the matched episodes. */
export function segmentsForEpisodes(
  episodes: readonly (TvdbEpisode | undefined)[],
  boundaries: number[],
  previous?: SplitSegment[],
): SplitSegment[] {
  return episodes.map((episode, index) => {
    const startSeconds = boundaries[index] ?? 0;
    const endSeconds = boundaries[index + 1] ?? startSeconds;
    const existing = previous?.[index];
    return {
      index,
      startSeconds: roundSeconds(startSeconds),
      endSeconds: roundSeconds(endSeconds),
      ...(existing?.cutSeconds !== undefined
        ? { cutSeconds: existing.cutSeconds }
        : {}),
      ...(episode ? { episode } : {}),
      ...(existing?.outputName ? { outputName: existing.outputName } : {}),
      ...(existing?.targetPath ? { targetPath: existing.targetPath } : {}),
    };
  });
}

export function segmentDurations(plan: OrganizeSplitPlan): number[] {
  return plan.segments.map((segment) =>
    Math.max(0, segment.endSeconds - segment.startSeconds),
  );
}

/**
 * Applies a manual filename override to a rendered split target. Only the last
 * path segment changes; the folder from the naming rules stays. A name typed
 * without an extension inherits the extension the rule produced, so the output
 * container still matches the source.
 */
export function applySplitOutputName(
  rendered: string,
  outputName?: string,
): string {
  const typed = outputName?.trim();
  if (!typed) return rendered;
  const separatorIndex = Math.max(
    rendered.lastIndexOf('/'),
    rendered.lastIndexOf('\\'),
  );
  const directory = rendered.slice(0, separatorIndex + 1);
  const defaultName = rendered.slice(separatorIndex + 1);
  const sanitized = sanitizePathSegment(typed);
  if (!sanitized) return rendered;
  if (sanitized.lastIndexOf('.') > 0) return `${directory}${sanitized}`;
  const dot = defaultName.lastIndexOf('.');
  const extension = dot > 0 ? defaultName.slice(dot) : '';
  return `${directory}${sanitized}${extension}`;
}

function splitTargetsForItemUnchecked(
  item: OrganizePlanItem,
  segments: SplitSegment[],
  options: SplitTargetOptions,
): SplitTargetReport {
  const caseInsensitive =
    options.caseInsensitive ?? options.settings.caseInsensitive ?? false;
  const skipped = new Set(options.skippedSegments ?? []);
  const keyFor = (value: string) =>
    organizerComparisonKey(value, { caseInsensitive });
  const sourceKey = keyFor(item.sourcePath);
  const existingKeys = new Set(
    (options.existingPaths ?? []).map((path) => keyFor(path)),
  );
  const used = new Set([sourceKey, ...existingKeys]);
  const seen = new Set<string>();
  const targetConflicts: SplitTargetConflict[] = [];
  const targets: (string | undefined)[] = [];
  const defaultTargets: (string | undefined)[] = [];
  for (const segment of segments) {
    if (!segment.episode) {
      targets.push(undefined);
      defaultTargets.push(undefined);
      continue;
    }
    const rendered = previewTargetForItem(
      item,
      { episode: segment.episode, episodes: [segment.episode] },
      {
        settings: options.settings,
        mediaType: options.mediaType,
        caseInsensitive,
      },
    );
    if (!rendered) {
      targets.push(undefined);
      defaultTargets.push(undefined);
      if (!skipped.has(segment.index)) {
        targetConflicts.push({
          segmentIndex: segment.index,
          kind: 'missing',
          message: `Segment ${segment.index + 1} has no rendered target path.`,
          overwriteable: false,
        });
      }
      continue;
    }
    const planned = applySplitOutputName(rendered, segment.outputName);
    defaultTargets.push(rendered);
    if (skipped.has(segment.index)) {
      // Keep the rendered path for display, but a skipped segment is never
      // written so it must not reserve or block anything.
      targets.push(planned);
      continue;
    }
    const key = keyFor(planned);
    if (options.settings.collisions === 'suffix' && used.has(key)) {
      const unique = uniqueTargetPath(planned, used, caseInsensitive);
      targets.push(unique);
      used.add(keyFor(unique));
      continue;
    }
    if (key === sourceKey) {
      targetConflicts.push({
        segmentIndex: segment.index,
        targetPath: planned,
        kind: 'source',
        message: `Target is the split's own source file: ${planned}`,
        overwriteable: false,
      });
    } else if (seen.has(key)) {
      targetConflicts.push({
        segmentIndex: segment.index,
        targetPath: planned,
        kind: 'duplicate',
        message: `Two segments of this split write the same target: ${planned}`,
        overwriteable: false,
      });
    } else if (existingKeys.has(key)) {
      targetConflicts.push({
        segmentIndex: segment.index,
        targetPath: planned,
        kind: 'exists',
        message: `Target already exists: ${planned}`,
        overwriteable: true,
      });
    }
    targets.push(planned);
    used.add(key);
    seen.add(key);
  }
  return {
    targets,
    defaultTargets,
    conflicts: targetConflicts.map((conflict) => conflict.message),
    targetConflicts,
  };
}

function uniqueTargetPath(
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
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let suffix = 2;
  let current = candidate;
  while (used.has(organizerComparisonKey(current, { caseInsensitive }))) {
    current = `${directory}${base} (${suffix})${extension}`;
    suffix += 1;
  }
  return current;
}

/**
 * Renders one target per segment using the same naming rules as the review
 * table. Reserved paths (other plan rows, existing files) are honored; the
 * collision policy decides between a numeric suffix and a blocking problem.
 */
export function splitTargetsForItem(
  item: OrganizePlanItem,
  segments: SplitSegment[],
  options: SplitTargetOptions,
): SplitTargetReport {
  const report = splitTargetsForItemUnchecked(item, segments, options);
  const caseInsensitive =
    options.caseInsensitive ?? options.settings.caseInsensitive ?? false;
  const skipped = new Set(options.skippedSegments ?? []);
  const reserved = new Set(
    (options.reservedPaths ?? []).map((path) =>
      organizerComparisonKey(path, { caseInsensitive }),
    ),
  );
  const targetConflicts = [...report.targetConflicts];
  for (const [position, target] of report.targets.entries()) {
    if (!target) continue;
    const segment = segments[position];
    if (!segment || skipped.has(segment.index)) continue;
    if (!reserved.has(organizerComparisonKey(target, { caseInsensitive }))) {
      continue;
    }
    const existingIndex = targetConflicts.findIndex(
      (conflict) =>
        conflict.segmentIndex === segment.index && conflict.kind === 'exists',
    );
    if (existingIndex >= 0) {
      // Another row claims this path, so overwriting the file on disk is not
      // safe even though it exists.
      targetConflicts[existingIndex] = {
        segmentIndex: segment.index,
        targetPath: target,
        kind: 'planned',
        message: `Target is already planned by another row: ${target}`,
        overwriteable: false,
      };
      continue;
    }
    if (
      targetConflicts.some(
        (conflict) => conflict.segmentIndex === segment.index,
      )
    ) {
      continue;
    }
    targetConflicts.push({
      segmentIndex: segment.index,
      targetPath: target,
      kind: 'planned',
      message: `Target is already planned by another row: ${target}`,
      overwriteable: false,
    });
  }
  return {
    targets: report.targets,
    defaultTargets: report.defaultTargets,
    conflicts: targetConflicts.map((conflict) => conflict.message),
    targetConflicts,
  };
}

/**
 * Paths other plan rows claim. A row that is being split no longer renames to
 * its single row target, so only its source stays reserved; its split outputs
 * are reserved separately from the split plan itself.
 */
export function reservedPathsForSplit(
  items: readonly OrganizePlanItem[],
  itemId: string,
  splitItemIds: ReadonlySet<string>,
): string[] {
  return items
    .filter((candidate) => candidate.id !== itemId)
    .flatMap((candidate) => {
      const split = splitItemIds.has(candidate.id);
      return [
        candidate.sourcePath,
        ...(split ? [] : [candidate.targetPath]),
        ...candidate.sidecars.flatMap((sidecar) =>
          split
            ? [sidecar.sourcePath]
            : [sidecar.sourcePath, sidecar.targetPath],
        ),
      ];
    });
}

export function withSplitTargets(
  item: OrganizePlanItem,
  segments: SplitSegment[],
  options: SplitTargetOptions,
): SplitTargetReport & { segments: SplitSegment[] } {
  const { targets, defaultTargets, conflicts, targetConflicts } =
    splitTargetsForItem(item, segments, options);
  return {
    segments: segments.map((segment, index) => ({
      ...segment,
      ...(targets[index] ? { targetPath: targets[index] } : {}),
    })),
    conflicts,
    targetConflicts,
    targets,
    ...(defaultTargets ? { defaultTargets } : {}),
  };
}

/** True when a segment is intentionally left unwritten. */
export function isSplitSegmentSkipped(
  plan: Pick<OrganizeSplitPlan, 'skippedSegments'>,
  segment: Pick<SplitSegment, 'index'>,
): boolean {
  return (plan.skippedSegments ?? []).includes(segment.index);
}

/** Segments that will produce an output file. */
export function activeSplitSegments(plan: OrganizeSplitPlan): SplitSegment[] {
  const skipped = new Set(plan.skippedSegments ?? []);
  return plan.segments.filter((segment) => !skipped.has(segment.index));
}

/** Structural problems that block saving or applying a split. */
export function validateSplitPlan(
  plan: OrganizeSplitPlan,
  options: { fileDurationSeconds?: number; toleranceSeconds?: number } = {},
): string[] {
  const problems: string[] = [];
  if (!plan.sourcePath) problems.push('The split has no source file.');
  if (!plan.itemId) problems.push('The split is not attached to a review row.');
  if (plan.segments.length < 2) {
    problems.push('A split needs at least two segments.');
  }
  if (
    !Number.isFinite(plan.fileDurationSeconds) ||
    plan.fileDurationSeconds <= 0
  ) {
    problems.push('The source duration is unknown; probe the file again.');
  }
  const tolerance = options.toleranceSeconds ?? 0.5;
  const duration = options.fileDurationSeconds ?? plan.fileDurationSeconds;
  let previousEnd = 0;
  const seenEpisodes = new Set<string>();
  const skipped = new Set(plan.skippedSegments ?? []);
  let activeCount = 0;
  for (const [index, segment] of plan.segments.entries()) {
    const label = `Segment ${index + 1}`;
    const isSkipped = skipped.has(segment.index);
    if (
      !Number.isFinite(segment.startSeconds) ||
      !Number.isFinite(segment.endSeconds)
    ) {
      problems.push(`${label} has an invalid time range.`);
      continue;
    }
    if (segment.startSeconds < -tolerance) {
      problems.push(`${label} starts before the file.`);
    }
    if (segment.endSeconds > duration + tolerance) {
      problems.push(`${label} ends after the file.`);
    }
    if (
      !isSkipped &&
      segment.endSeconds - segment.startSeconds < MIN_SEGMENT_SECONDS
    ) {
      problems.push(`${label} is shorter than ${MIN_SEGMENT_SECONDS} seconds.`);
    }
    if (segment.startSeconds < previousEnd - tolerance) {
      problems.push(`${label} overlaps the previous segment.`);
    }
    previousEnd = segment.endSeconds;
    if (isSkipped) continue;
    activeCount += 1;
    if (!segment.episode) {
      problems.push(`${label} has no episode assigned.`);
      continue;
    }
    const key = `${segment.episode.seasonNumber}:${segment.episode.episodeNumber}`;
    if (seenEpisodes.has(key)) {
      problems.push(
        `${segment.episode.tag} is assigned to more than one segment.`,
      );
    }
    seenEpisodes.add(key);
  }
  if (activeCount === 0) {
    problems.push('Every segment of this split is skipped.');
  }
  const last = plan.segments[plan.segments.length - 1];
  if (last && duration > 0 && last.endSeconds < duration - tolerance) {
    problems.push('The last segment does not reach the end of the file.');
  }
  return problems;
}

/** The Plex row that represents one segment's episode. */
export function associationForSegment(
  item: OrganizePlanItem,
  episode: TvdbEpisode,
): PlexAssociation | undefined {
  const associations = item.plexEpisodes?.length
    ? item.plexEpisodes
    : item.plex
      ? [item.plex]
      : [];
  return (
    associations.find(
      (association) =>
        association.seasonNumber === episode.seasonNumber &&
        association.episodeNumber === episode.episodeNumber,
    ) ??
    associations[item.episodes?.indexOf(episode) ?? 0] ??
    associations[0]
  );
}

export function splitOutputCount(splits: readonly OrganizeSplitPlan[]): number {
  return splits.reduce(
    (total, split) => total + activeSplitSegments(split).length,
    0,
  );
}

export function findSplitForItem(
  splits: readonly OrganizeSplitPlan[],
  itemId: string,
): OrganizeSplitPlan | undefined {
  return splits.find((split) => split.itemId === itemId);
}

/**
 * Drops queued splits whose row disappeared or whose episode range changed
 * after a re-match. Returns the surviving splits and a warning per dropped one.
 */
export function pruneSplitPlans(
  splits: readonly OrganizeSplitPlan[],
  items: readonly OrganizePlanItem[],
): { splits: OrganizeSplitPlan[]; dropped: string[] } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept: OrganizeSplitPlan[] = [];
  const dropped: string[] = [];
  for (const split of splits) {
    const item = byId.get(split.itemId);
    if (!item) {
      dropped.push(split.sourcePath);
      continue;
    }
    const range = item.episodes ?? (item.episode ? [item.episode] : []);
    if (range.length < 2 || range.length !== split.segments.length) {
      dropped.push(split.sourcePath);
      continue;
    }
    const expected = range
      .map((episode) => `${episode.seasonNumber}:${episode.episodeNumber}`)
      .join('|');
    const actual = split.segments
      .map((segment) =>
        segment.episode
          ? `${segment.episode.seasonNumber}:${segment.episode.episodeNumber}`
          : '',
      )
      .join('|');
    if (expected !== actual) {
      dropped.push(split.sourcePath);
      continue;
    }
    kept.push(split);
  }
  return { splits: kept, dropped };
}

export const SPLIT_MIN_SEGMENT_SECONDS = MIN_SEGMENT_SECONDS;

/** `3725.4` → `1:02:05.4`; hours are omitted below one hour. */
export function formatSplitTimecode(
  seconds: number,
  withMilliseconds = false,
): string {
  const safe = Math.max(0, seconds);
  if (withMilliseconds) {
    // Round to tenths before splitting, otherwise floating point can display
    // 1800.1 as 30:00.0 and make a +0.1s nudge look like it did nothing.
    const totalTenths = Math.round(safe * 10);
    const hours = Math.floor(totalTenths / 36000);
    const minutes = Math.floor((totalTenths % 36000) / 600);
    const wholeSeconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    const base =
      hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(
            wholeSeconds,
          ).padStart(2, '0')}`
        : `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
    return `${base}.${tenths}`;
  }
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const base =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(
          wholeSeconds,
        ).padStart(2, '0')}`
      : `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
  return base;
}
