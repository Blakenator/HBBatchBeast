/**
 * Show-folder helpers for TV libraries.
 *
 * A TV library source folder is a container of shows: each show lives in its
 * own subfolder. A source folder that directly contains media is treated as a
 * single show (`subpath: ''`). This module is pure so the backend and the
 * renderer agree on which mapping a file belongs to.
 */

import type { TvdbSeriesRef } from './types';
import type { OrganizeSettings, TvdbShowMapping } from './settings';
import { normalizeTitle } from './filename';
import { similarity } from './match';
import { organizerComparisonKey } from './paths';

/** A detected show folder under one library source folder. */
export interface ShowFolder {
  folderId: string;
  /** Absolute path of the library source folder. */
  root: string;
  /** Path relative to `root`, `/`-separated; `''` when the root is the show. */
  subpath: string;
  /** Folder name for display; the root folder name when `subpath` is ''. */
  name: string;
  mediaCount: number;
}

/** A detected show folder plus any existing or automatic series match. */
export interface DetectedShow extends ShowFolder {
  series?: TvdbSeriesRef;
  /** True when the match came from the folder name only. */
  autoMatched?: boolean;
  /** Query derived from the folder name; reused when opening the search. */
  query?: string;
  /** TVDB results already fetched for this folder (shown before re-searching). */
  candidates?: TvdbSeriesRef[];
}

/** Normalises a subpath to '/'-separated segments without a trailing slash. */
export function normalizeSubpath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
}

export function createShowMappingId(): string {
  return `show-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function showFolderKey(folderId: string, subpath: string): string {
  return `${folderId}:${normalizeSubpath(subpath)}`;
}

/** Mappings that belong to one library source folder. */
export function showMappingsForFolder(
  settings: OrganizeSettings,
  folderId: string,
): TvdbShowMapping[] {
  return (settings.tvdb?.shows ?? []).filter(
    (mapping) => mapping.folderId === folderId,
  );
}

export function findShowMapping(
  settings: OrganizeSettings,
  folderId: string,
  subpath: string,
): TvdbShowMapping | undefined {
  const key = normalizeSubpath(subpath).toLowerCase();
  return (settings.tvdb?.shows ?? []).find(
    (mapping) =>
      mapping.folderId === folderId &&
      normalizeSubpath(mapping.subpath).toLowerCase() === key,
  );
}

/**
 * Finds the mapping a file belongs to.
 *
 * A root-level mapping (`subpath: ''`) means "the whole folder is one show" and
 * wins outright, because the user asked for it explicitly. Otherwise the
 * longest matching subpath wins.
 */
export function resolveShowMapping(
  settings: OrganizeSettings,
  folderId: string,
  relativePath: string,
  options: { caseInsensitive?: boolean } = {},
): TvdbShowMapping | undefined {
  const rootMapping = showMappingsForFolder(settings, folderId).find(
    (mapping) => normalizeSubpath(mapping.subpath) === '',
  );
  if (rootMapping) return rootMapping;
  const relativeKey = organizerComparisonKey(normalizeSubpath(relativePath), {
    caseInsensitive: options.caseInsensitive ?? true,
  });
  const candidates = showMappingsForFolder(settings, folderId).filter(
    (mapping) => {
      const subpath = normalizeSubpath(mapping.subpath);
      if (!subpath) return true;
      const key = organizerComparisonKey(subpath, {
        caseInsensitive: options.caseInsensitive ?? true,
      });
      return relativeKey === key || relativeKey.startsWith(`${key}/`);
    },
  );
  return candidates.sort(
    (left, right) =>
      normalizeSubpath(right.subpath).length -
      normalizeSubpath(left.subpath).length,
  )[0];
}

/** Replaces (or adds) the mapping for one show folder. */
export function upsertShowMapping(
  settings: OrganizeSettings,
  mapping: TvdbShowMapping,
): OrganizeSettings {
  const shows = settings.tvdb?.shows ?? [];
  const subpath = normalizeSubpath(mapping.subpath);
  const next = shows.filter(
    (candidate) =>
      !(
        candidate.folderId === mapping.folderId &&
        normalizeSubpath(candidate.subpath).toLowerCase() ===
          subpath.toLowerCase()
      ),
  );
  return {
    ...settings,
    tvdb: {
      ...settings.tvdb,
      shows: [...next, { ...mapping, subpath }],
    },
  };
}

/** Drops the mapping for one show folder (and that folder's file overrides). */
export function removeShowMapping(
  settings: OrganizeSettings,
  folderId: string,
  subpath: string,
): OrganizeSettings {
  const normalized = normalizeSubpath(subpath).toLowerCase();
  const shows = (settings.tvdb?.shows ?? []).filter(
    (mapping) =>
      !(
        mapping.folderId === folderId &&
        normalizeSubpath(mapping.subpath).toLowerCase() === normalized
      ),
  );
  return { ...settings, tvdb: { ...settings.tvdb, shows } };
}

const RELEASE_TAGS =
  /\b(2160p|1080p|720p|480p|576p|uhd|4k|bluray|blu-ray|webrip|web-dl|webdl|hdtv|dvdrip|brrip|x264|x265|h264|h265|hevc|avc|xvid|divx|aac|ac3|eac3|dts(-hd)?|truehd|atmos|flac|10bit|8bit|remux|proper|repack|extended|uncut|multi|subbed|dubbed)\b/gi;
const BRACKETED = /[[(]([^\])]*)[\])]/g;
const RELEASE_GROUP = /\s-\s*[A-Za-z0-9]{2,}$/;
const SERIES_ID = /\{[a-z]+-\d+\}/gi;
const YEAR = /\b(19\d{2}|20\d{2})\b/;

export interface SeriesQueryGuess {
  query: string;
  year?: number;
}

/**
 * Turns a show folder name into a TVDB search query.
 * `Blue.Planet.II.2017.1080p.BluRay` → `{ query: 'Blue Planet II', year: 2017 }`.
 */
export function guessSeriesQuery(folderName: string): SeriesQueryGuess {
  let working = folderName.replace(SERIES_ID, ' ');
  let year: number | undefined;
  working = working.replace(BRACKETED, (match, inner: string) => {
    const text = String(inner).trim();
    if (/^\d{4}$/.test(text)) {
      year = Number(text);
      return ' ';
    }
    // Keep a country marker such as "(US)" as disambiguation.
    if (/^[A-Z]{2,3}$/.test(text)) return ` ${text} `;
    return ' ';
  });
  working = working
    .replace(/[._]+/g, ' ')
    .replace(RELEASE_TAGS, ' ')
    .replace(RELEASE_GROUP, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const yearMatch = YEAR.exec(working);
  if (yearMatch) {
    const withoutYear = working.replace(yearMatch[0], ' ').replace(/\s+/g, ' ').trim();
    if (withoutYear) {
      year = year ?? Number(yearMatch[0]);
      working = withoutYear;
    }
  }
  if (!working) working = folderName.trim();
  return year === undefined ? { query: working } : { query: working, year };
}

export interface SeriesMatch extends SeriesQueryGuess {
  series: TvdbSeriesRef;
  score: number;
}

const MIN_SERIES_SCORE = 0.82;

/**
 * Picks the closest TVDB series for a folder-name guess. Returns `undefined`
 * instead of guessing when nothing is close enough.
 */
export function pickBestSeries(
  candidates: TvdbSeriesRef[],
  guess: SeriesQueryGuess,
): SeriesMatch | undefined {
  const target = normalizeTitle(guess.query);
  if (!target) return undefined;
  let best: SeriesMatch | undefined;
  for (const series of candidates) {
    const nameScore = similarity(guess.query, series.name);
    const yearPenalty =
      guess.year && series.year && Math.abs(guess.year - series.year) > 1
        ? 0.25
        : 0;
    const yearBonus = guess.year && series.year === guess.year ? 0.08 : 0;
    const score = Math.max(0, Math.min(1, nameScore + yearBonus - yearPenalty));
    if (score < MIN_SERIES_SCORE) continue;
    if (!best || score > best.score) {
      best = { series, score, ...guess };
    }
  }
  return best;
}
