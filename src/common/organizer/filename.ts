import type { ParsedMediaName, TvdbEpisode } from './types';

export const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mkv',
  'mov',
  'm4v',
  'mpg',
  'mpeg',
  'avi',
  'flv',
  'webm',
  'wmv',
  'vob',
  'evo',
  'mts',
  'm2ts',
  'ts',
  'iso',
]);

export const SIDECAR_EXTENSIONS = new Set(['srt', 'ass', 'vtt', 'nfo', 'sub', 'idx']);

const RESOLUTION_BREAKPOINTS: [number, string][] = [
  [2160, '4K'],
  [1440, '1440p'],
  [1080, '1080p'],
  [720, '720p'],
  [576, '576p'],
  [480, '480p'],
  [0, 'SD'],
];

const RELEASE_TAGS =
  /\b(bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdtv|dvdrip|dvd|x264|x265|h264|h265|hevc|av1|aac|ac3|dd5\.1|dts|proper|repack|extended|remastered|10bit|hdr|uhd)\b/gi;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[._]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Comparison key for filenames and episode titles: lowercase, punctuation-free,
 * with hyphens treated as spaces. Use this on both sides of every match/search.
 */
export function titleComparisonKey(value: string): string {
  return normalizeTitle(value)
    .replace(/['’]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolutionLabel(
  height: number | undefined,
  fallback?: string,
): string | undefined {
  if (height && Number.isFinite(height)) {
    return RESOLUTION_BREAKPOINTS.find(([min]) => height >= min)?.[1];
  }
  return fallback;
}

function parseResolution(text: string): {
  label?: string;
  width?: number;
  height?: number;
} {
  const dimensions = /\b(\d{3,4})x(\d{3,4})\b/.exec(text);
  if (dimensions) {
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (width >= 240 && height >= 240) {
      return { label: resolutionLabel(height), width, height };
    }
  }
  const explicit = /(2160p|1440p|1080p|720p|576p|480p|4k|uhd)/i.exec(text);
  if (explicit) {
    const value = explicit[1].toLowerCase();
    if (value === '4k' || value === 'uhd' || value === '2160p') {
      return { label: '4K', height: 2160 };
    }
    return { label: value, height: Number(value.replace('p', '')) };
  }
  return {};
}

function seasonFromFolders(relativePath: string): number | undefined {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    if (/^specials?$/i.test(segments[index].trim())) {
      return 0;
    }
    const match =
      /(?:^|[\s._-])season[\s._-]*(\d{1,2})(?:$|[\s._-])/i.exec(segments[index]) ??
      /(?:^|[\s._-])s(\d{1,2})(?:$|[\s._-])/i.exec(segments[index]);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function cleanTitle(value: string): string {
  return value
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(RELEASE_TAGS, ' ')
    .replace(/\b(?:19|20)\d{2}[.\s_-]\d{1,2}[.\s_-]\d{1,2}\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{3,4}x\d{3,4}\b/gi, ' ')
    .replace(/\b(2160p|1440p|1080p|720p|576p|480p|4k|uhd)\b/gi, ' ')
    .replace(/\bS\d{1,2}E\d{1,3}(?:E\d{1,3})*\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
    .replace(/\b(season|episode|ep|e)\s*\d{1,3}\b/gi, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'&]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Episode-title text following a matched tag, when the filename has one. */
function titleAfterTag(
  base: string,
  match: RegExpExecArray | null,
): string | undefined {
  if (!match || match.index === undefined) return undefined;
  const trailing = cleanTitle(base.slice(match.index + match[0].length));
  return trailing || undefined;
}

/**
 * Parses whatever a release name gives us. Explicit SxxEyy always wins; folder
 * season numbers and absolute episode numbers are fallbacks for poorly named
 * libraries. The returned title is deliberately conservative.
 */
export function parseMediaFilename(
  filename: string,
  relativePath = filename,
): ParsedMediaName {
  const base = stripExtension(filename);
  const folderSeason = seasonFromFolders(relativePath);

  let seasonNumber: number | undefined;
  let episodeNumbers: number[] | undefined;
  let episodeNumber: number | undefined;
  let isSpecial = false;
  let tagMatch: RegExpExecArray | null = null;

  const special = /\bspecial\s*(\d{1,2})x(\d{1,3})\b/i.exec(base);
  const tag = /\bS(\d{1,2})E(\d{1,3})((?:E\d{1,3})*)\b/i.exec(base);
  const crossed = /\b(\d{1,2})x(\d{1,3})\b/.exec(base);
  const seasonSentence = /\bseason\s*(\d{1,2}).*?\bepisode\s*(\d{1,3})\b/i.exec(
    base,
  );
  const episodeOnly = /(?:^|[\s._-])E(?:P)?(\d{1,3})(?:$|[\s._-])/i.exec(base);

  if (special) {
    tagMatch = special;
    seasonNumber = 0;
    episodeNumber = Number(special[2]);
    episodeNumbers = [episodeNumber];
    isSpecial = true;
  } else if (tag) {
    tagMatch = tag;
    seasonNumber = Number(tag[1]);
    episodeNumber = Number(tag[2]);
    episodeNumbers = [episodeNumber];
    const extra = tag[3].match(/\d{1,3}/g) ?? [];
    episodeNumbers.push(...extra.map(Number));
    isSpecial = seasonNumber === 0;
  } else if (crossed) {
    tagMatch = crossed;
    seasonNumber = Number(crossed[1]);
    episodeNumber = Number(crossed[2]);
    episodeNumbers = [episodeNumber];
    isSpecial = seasonNumber === 0;
  } else if (seasonSentence) {
    tagMatch = seasonSentence;
    seasonNumber = Number(seasonSentence[1]);
    episodeNumber = Number(seasonSentence[2]);
    episodeNumbers = [episodeNumber];
  } else if (folderSeason !== undefined && episodeOnly) {
    tagMatch = episodeOnly;
    seasonNumber = folderSeason;
    episodeNumber = Number(episodeOnly[1]);
    episodeNumbers = [episodeNumber];
  }

  // A Specials folder is authoritative even when the file still carries S01.
  if (folderSeason === 0) {
    seasonNumber = 0;
    isSpecial = true;
  }

  const yearMatch =
    /\((?:19|20)\d{2}\)/.exec(base) ??
    /(?:^|[.\s_-])((?:19|20)\d{2})(?:$|[.\s_-])/.exec(base);
  const yearText = yearMatch?.[0].match(/(?:19|20)\d{2}/)?.[0];
  const year = yearText ? Number(yearText) : undefined;

  const resolution = parseResolution(base);
  const title = cleanTitle(base) || cleanTitle(stripExtension(relativePath));
  const episodeTitle = titleAfterTag(base, tagMatch);
  const airDate = /\b((?:19|20)\d{2})[.\s_-](\d{2})[.\s_-](\d{2})\b/.exec(
    base,
  );

  return {
    title,
    cleanTitle: normalizeTitle(title),
    ...(episodeTitle ? { episodeTitle } : {}),
    ...(year ? { year } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeNumbers ? { episodeNumbers } : {}),
    ...(resolution.label ? { resolution: resolution.label } : {}),
    ...(resolution.width ? { width: resolution.width } : {}),
    ...(resolution.height ? { height: resolution.height } : {}),
    ...(isSpecial ? { isSpecial } : {}),
    ...(airDate
      ? { airDate: `${airDate[1]}-${airDate[2]}-${airDate[3]}` }
      : {}),
  };
}

export function episodeTag(seasonNumber: number, episodeNumber: number): string {
  if (seasonNumber === 0) {
    return `S00E${String(episodeNumber).padStart(2, '0')}`;
  }
  return `S${String(seasonNumber).padStart(2, '0')}E${String(
    episodeNumber,
  ).padStart(2, '0')}`;
}

/** Display tag; specials always use the S00 season. */
export function episodeDisplayTag(episode: TvdbEpisode): string {
  if (episode.seasonNumber === 0) {
    return episodeTag(0, episode.episodeNumber);
  }
  return episode.tag || episodeTag(episode.seasonNumber, episode.episodeNumber);
}

export function isMediaExtension(extension: string): boolean {
  return MEDIA_EXTENSIONS.has(extension.toLowerCase());
}
