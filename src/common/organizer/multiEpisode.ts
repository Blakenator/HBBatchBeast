/**
 * Multi-episode helpers shared by the scanner and the review UI.
 *
 * A file that holds several episodes is identified by a run of consecutive
 * TVDB episodes. The run can come from an explicit filename tag (`S01E02-E03`),
 * from episode titles joined in the filename (`S01E02 - The Deep and Coral
 * Reefs`), or from a batch decision the user makes in review (sequential or
 * "current numbering + N"). Everything here is pure so both sides agree.
 */

import type { OrganizePlanItem, ParsedMediaName, TvdbEpisode } from './types';
import { episodeRangeTag, episodeTag } from './filename';
import {
  EPISODE_RUN_NAME_MARGIN,
  NAME_MATCH_THRESHOLD,
  episodeNameText,
  nameSimilarity,
  type EpisodeNameRun,
} from './match';

export const MULTI_EPISODE_MIN_RUN = 2;
export const MULTI_EPISODE_MAX_RUN = 6;
export const MULTI_EPISODE_NAME_THRESHOLD = NAME_MATCH_THRESHOLD;
/** The joined-titles score has to beat the best single title by this margin. */
export const MULTI_EPISODE_NAME_MARGIN = EPISODE_RUN_NAME_MARGIN;
/** Small tie-break for the tagged/current episode in a filename-based search. */
export const MULTI_EPISODE_PREFERRED_BONUS = 0.03;

export interface EpisodeRun extends EpisodeNameRun {
  startEpisodeNumber: number;
  endEpisodeNumber: number;
}

export interface EpisodeRunOptions {
  seriesName?: string;
  /**
   * Restricts the run to a season and (optionally) requires it to start at
   * this episode. Automatic scanning passes the resolved episode so a file is
   * only ever extended forward, never jumped to another episode.
   */
  anchorEpisode?: TvdbEpisode;
  /** A run starting at this episode gets a small score bonus. */
  preferredEpisodeNumber?: number;
  /** Highest number of episodes one file can cover. */
  maxRun?: number;
}

export type MultiEpisodeProblemKind =
  | 'past-end'
  | 'missing-episode'
  | 'unknown-season'
  | 'invalid-count';

export interface MultiEpisodeProblem {
  kind: MultiEpisodeProblemKind;
  message: string;
}

export interface EpisodeRangeResult {
  episodes?: TvdbEpisode[];
  problem?: MultiEpisodeProblem;
}

function sortedSeason(
  episodes: readonly TvdbEpisode[],
  seasonNumber: number,
): TvdbEpisode[] {
  const byNumber = new Map<number, TvdbEpisode>();
  for (const episode of episodes) {
    if (episode.seasonNumber !== seasonNumber) continue;
    if (!byNumber.has(episode.episodeNumber)) {
      byNumber.set(episode.episodeNumber, episode);
    }
  }
  return [...byNumber.values()].sort(
    (left, right) => left.episodeNumber - right.episodeNumber,
  );
}

function isConsecutive(episodes: readonly TvdbEpisode[]): boolean {
  return episodes.every(
    (episode, index) =>
      index === 0 ||
      episode.episodeNumber === episodes[index - 1].episodeNumber + 1,
  );
}

function runFor(
  seasonNumber: number,
  episodes: TvdbEpisode[],
  score: number,
  singleScore: number,
): EpisodeRun {
  return {
    seasonNumber,
    episodes,
    startEpisodeNumber: episodes[0].episodeNumber,
    endEpisodeNumber: episodes[episodes.length - 1].episodeNumber,
    score,
    singleScore,
    tag: episodeRangeTag(
      seasonNumber,
      episodes.map((episode) => episode.episodeNumber),
    ),
  };
}

/**
 * Finds the consecutive episode run whose joined titles best explain the
 * filename's episode-title text. Returns `undefined` when the title does not
 * clearly cover more than one episode, so a single-episode file is never
 * stretched.
 */
export function detectEpisodeRunFromName(
  parsed: ParsedMediaName,
  catalog: readonly TvdbEpisode[],
  options: EpisodeRunOptions = {},
): EpisodeRun | undefined {
  const seriesName = options.seriesName;
  const nameText = episodeNameText(parsed, seriesName);
  if (!nameText) return undefined;

  const anchor = options.anchorEpisode;
  const seasonNumber = anchor?.seasonNumber ?? parsed.seasonNumber;
  if (seasonNumber === undefined) return undefined;
  const season = sortedSeason(catalog, seasonNumber);
  if (season.length < MULTI_EPISODE_MIN_RUN) return undefined;

  const maxRun = Math.max(
    MULTI_EPISODE_MIN_RUN,
    Math.min(
      options.maxRun ?? MULTI_EPISODE_MAX_RUN,
      season.length,
    ),
  );
  const anchorNumber =
    anchor?.seasonNumber === seasonNumber ? anchor.episodeNumber : undefined;

  let best: EpisodeRun | undefined;
  let bestAdjusted = Number.NEGATIVE_INFINITY;
  for (let startIndex = 0; startIndex < season.length; startIndex += 1) {
    const startEpisode = season[startIndex];
    if (
      anchorNumber !== undefined &&
      startEpisode.episodeNumber !== anchorNumber
    ) {
      continue;
    }
    const singleScore = nameSimilarity(nameText, startEpisode.name);
    for (
      let length = MULTI_EPISODE_MIN_RUN;
      length <= maxRun && startIndex + length <= season.length;
      length += 1
    ) {
      const run = season.slice(startIndex, startIndex + length);
      if (!isConsecutive(run)) continue;
      const joined = run.map((episode) => episode.name).join(', ');
      const score = nameSimilarity(nameText, joined);
      const adjusted =
        score +
        (options.preferredEpisodeNumber === startEpisode.episodeNumber
          ? MULTI_EPISODE_PREFERRED_BONUS
          : 0);
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        best = runFor(seasonNumber, run, score, singleScore);
      }
    }
  }

  if (!best) return undefined;
  if (best.score < MULTI_EPISODE_NAME_THRESHOLD) return undefined;
  // The extra titles have to explain the filename meaningfully better than the
  // first title alone; otherwise this is a normal single-episode file.
  if (best.score - best.singleScore < MULTI_EPISODE_NAME_MARGIN) {
    return undefined;
  }
  return best;
}

/**
 * The consecutive episodes from `startNumber` for `count` files slots, or a
 * reason the range cannot exist. A season boundary is never crossed: silently
 * shortening a run would drop an episode from the library.
 */
export function episodesForStart(
  catalog: readonly TvdbEpisode[],
  seasonNumber: number | undefined,
  startNumber: number,
  count: number,
): EpisodeRangeResult {
  if (!Number.isInteger(count) || count < 1) {
    return {
      problem: {
        kind: 'invalid-count',
        message: 'Episodes per file must be a whole number of at least 1.',
      },
    };
  }
  if (!Number.isInteger(startNumber) || startNumber < 0) {
    return {
      problem: {
        kind: 'invalid-count',
        message: 'The start episode must be a whole number.',
      },
    };
  }
  if (seasonNumber === undefined) {
    return {
      problem: {
        kind: 'unknown-season',
        message: 'The season is unknown; set it with Fix match first.',
      },
    };
  }
  const season = sortedSeason(catalog, seasonNumber);
  if (season.length === 0) {
    return {
      problem: {
        kind: 'unknown-season',
        message: `No episodes were found for Season ${String(
          seasonNumber,
        ).padStart(2, '0')}.`,
      },
    };
  }
  const lastNumber = season[season.length - 1].episodeNumber;
  const endNumber = startNumber + count - 1;
  if (endNumber > lastNumber) {
    return {
      problem: {
        kind: 'past-end',
        message: `${episodeTag(seasonNumber, startNumber)}-E${String(
          endNumber,
        ).padStart(2, '0')} runs past the end of Season ${String(
          seasonNumber,
        ).padStart(2, '0')} (last episode ${episodeTag(
          seasonNumber,
          lastNumber,
        )}).`,
      },
    };
  }
  const byNumber = new Map(
    season.map((episode) => [episode.episodeNumber, episode]),
  );
  const episodes: TvdbEpisode[] = [];
  for (let number = startNumber; number <= endNumber; number += 1) {
    const episode = byNumber.get(number);
    if (!episode) {
      return {
        problem: {
          kind: 'missing-episode',
          message: `${episodeTag(
            seasonNumber,
            number,
          )} is not in TVDB Season ${String(seasonNumber).padStart(2, '0')}.`,
        },
      };
    }
    episodes.push(episode);
  }
  return { episodes };
}

/** The first episode number a plan row currently points at, when known. */
export function planItemStartEpisode(
  item: OrganizePlanItem,
): number | undefined {
  return (
    item.episode?.episodeNumber ??
    item.episodes?.[0]?.episodeNumber ??
    item.parsed?.episodeNumber
  );
}

/** The season a plan row currently points at, when known. */
export function planItemSeason(
  item: OrganizePlanItem,
): number | undefined {
  return (
    item.episode?.seasonNumber ??
    item.episodes?.[0]?.seasonNumber ??
    item.parsed?.seasonNumber
  );
}

export interface SequenceGroup {
  key: string;
  seriesName: string;
  seasonNumber: number;
  items: OrganizePlanItem[];
}

export interface SequenceGrouping {
  groups: SequenceGroup[];
  /** Rows with no show or no season; sequential numbering cannot order them. */
  ungrouped: OrganizePlanItem[];
}

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function relativePathOf(item: OrganizePlanItem): string {
  return item.sourceRelativePath || item.sourcePath;
}

/**
 * Groups rows by show and season for sequential numbering and orders them
 * deterministically: episode number first (when known), then a natural path
 * sort so `Episode 2` stays before `Episode 10`.
 */
export function groupItemsForSequence(
  items: readonly OrganizePlanItem[],
): SequenceGrouping {
  const groups = new Map<string, SequenceGroup>();
  const ungrouped: OrganizePlanItem[] = [];
  for (const item of items) {
    const seriesName = item.seriesName ?? item.showFolder;
    const seasonNumber = planItemSeason(item);
    if (!seriesName || seasonNumber === undefined) {
      ungrouped.push(item);
      continue;
    }
    const key = `${seriesName.toLowerCase()}\u0000${seasonNumber}`;
    const group = groups.get(key) ?? {
      key,
      seriesName,
      seasonNumber,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.items.sort((left, right) => {
      const leftStart = planItemStartEpisode(left);
      const rightStart = planItemStartEpisode(right);
      if (leftStart !== undefined && rightStart !== undefined) {
        if (leftStart !== rightStart) return leftStart - rightStart;
      } else if (leftStart !== undefined || rightStart !== undefined) {
        return leftStart === undefined ? 1 : -1;
      }
      return naturalCollator.compare(
        relativePathOf(left),
        relativePathOf(right),
      );
    });
  }
  return {
    groups: [...groups.values()].sort(
      (left, right) =>
        naturalCollator.compare(left.seriesName, right.seriesName) ||
        left.seasonNumber - right.seasonNumber,
    ),
    ungrouped,
  };
}

/**
 * Assigns the start episode for every row in every group. Each group restarts
 * at its base (E01 by default) and advances by `count` for every row.
 */
export function sequenceStarts(
  groups: readonly SequenceGroup[],
  count: number,
  baseByGroup: Readonly<Record<string, number>> = {},
): Map<string, number> {
  const starts = new Map<string, number>();
  const step = Math.max(1, Math.trunc(count));
  for (const group of groups) {
    let next = Math.max(1, Math.trunc(baseByGroup[group.key] ?? 1));
    for (const item of group.items) {
      starts.set(item.id, next);
      next += step;
    }
  }
  return starts;
}

/**
 * Re-bases a group so `rowIndex` starts at `desiredStart` and every later row
 * cascades by `count`. Used when the user edits one number in the preview.
 */
export function rebaseSequenceBase(
  count: number,
  rowIndex: number,
  desiredStart: number,
): number {
  const step = Math.max(1, Math.trunc(count));
  const start = Math.max(1, Math.trunc(desiredStart));
  return Math.max(1, start - Math.max(0, rowIndex) * step);
}
