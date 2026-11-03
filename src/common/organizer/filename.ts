import type { ParsedMediaName } from './types';

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
  [2000, '4K'],
  [1400, '1440p'],
  [1000, '1080p'],
  [700, '720p'],
  [500, '480p'],
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

export function resolutionLabel(
  height: number | undefined,
  fallback?: string,
): string | undefined {
  if (height && Number.isFinite(height)) {
    return RESOLUTION_BREAKPOINTS.find(([min]) => height > min)?.[1];
  }
  return fallback;
}

function parseResolution(text: string): { label?: string; height?: number } {
  const explicit = /(2160p|1440p|1080p|720p|480p|4k|uhd)/i.exec(text);
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
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(2160p|1440p|1080p|720p|480p|4k|uhd)\b/gi, ' ')
    .replace(/\bS\d{1,2}E\d{1,3}(?:E\d{1,3})*\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
    .replace(/\b(season|episode|ep|e)\s*\d{1,3}\b/gi, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'&]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  const special = /\bspecial\s*(\d{1,2})x(\d{1,3})\b/i.exec(base);
  const tag = /\bS(\d{1,2})E(\d{1,3})((?:E\d{1,3})*)\b/i.exec(base);
  const crossed = /\b(\d{1,2})x(\d{1,3})\b/.exec(base);
  const seasonSentence = /\bseason\s*(\d{1,2}).*?\bepisode\s*(\d{1,3})\b/i.exec(
    base,
  );
  const episodeOnly = /(?:^|[\s._-])E(?:P)?(\d{1,3})(?:$|[\s._-])/i.exec(base);

  if (special) {
    seasonNumber = Number(special[1]);
    episodeNumber = Number(special[2]);
    episodeNumbers = [episodeNumber];
    isSpecial = true;
  } else if (tag) {
    seasonNumber = Number(tag[1]);
    episodeNumber = Number(tag[2]);
    episodeNumbers = [episodeNumber];
    const extra = tag[3].match(/\d{1,3}/g) ?? [];
    episodeNumbers.push(...extra.map(Number));
    isSpecial = seasonNumber === 0;
  } else if (crossed) {
    seasonNumber = Number(crossed[1]);
    episodeNumber = Number(crossed[2]);
    episodeNumbers = [episodeNumber];
    isSpecial = seasonNumber === 0;
  } else if (seasonSentence) {
    seasonNumber = Number(seasonSentence[1]);
    episodeNumber = Number(seasonSentence[2]);
    episodeNumbers = [episodeNumber];
  } else if (folderSeason !== undefined && episodeOnly) {
    seasonNumber = folderSeason;
    episodeNumber = Number(episodeOnly[1]);
    episodeNumbers = [episodeNumber];
  }

  const yearMatch =
    /\((?:19|20)\d{2}\)/.exec(base) ??
    /(?:^|[.\s_-])((?:19|20)\d{2})(?:$|[.\s_-])/.exec(base);
  const yearText = yearMatch?.[0].match(/(?:19|20)\d{2}/)?.[0];
  const year = yearText ? Number(yearText) : undefined;

  const resolution = parseResolution(base);
  const title = cleanTitle(base) || cleanTitle(stripExtension(relativePath));
  const airDate = /\b((?:19|20)\d{2})[.\s_-](\d{2})[.\s_-](\d{2})\b/.exec(
    base,
  );

  return {
    title,
    cleanTitle: normalizeTitle(title),
    ...(year ? { year } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeNumbers ? { episodeNumbers } : {}),
    ...(resolution.label ? { resolution: resolution.label } : {}),
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

export function isMediaExtension(extension: string): boolean {
  return MEDIA_EXTENSIONS.has(extension.toLowerCase());
}
