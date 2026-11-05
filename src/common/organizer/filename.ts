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

/**
 * Plex's resolution buckets. A bucket is reached when either dimension meets
 * its threshold, so anamorphic and letterboxed frames classify the same way
 * Plex classifies them (1920x800 is 1080p, 720x480 is 480p). Encoders often
 * crop a few pixels, so dimensions within 5% below a threshold still count
 * (1918x1072 is still 1080p).
 */
const RESOLUTION_TOLERANCE = 0.05;

const RESOLUTION_BUCKETS: [number, number, string][] = [
  [7680, 4320, '8K'],
  [3840, 2160, '4K'],
  [2560, 1440, '2K'],
  [1920, 1080, '1080p'],
  [1280, 720, '720p'],
  [1024, 576, '576p'],
  [720, 480, '480p'],
  [0, 0, 'SD'],
];

const RELEASE_TAGS =
  /\b(bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdtv|dvdrip|dvd|x264|x265|h264|h265|hevc|av1|aac|ac3|dd5\.1|dts|proper|repack|extended|remastered|10bit|hdr|uhd)\b/gi;

/**
 * Extra episodes after a `SxxEyy` tag: `E03`, `-E03`, `-03` and any mix of
 * them, so `S01E02E03`, `S01E02-E03`, `S01E02-03` and `S01 E02-E03` all parse.
 */
const TAG_TAIL = String.raw`(?:[.\s_-]*-[.\s_-]*E?\d{1,3}(?!\d)|[._-]?E\d{1,3})*`;

/** `SxxEyy` tag, allowing a separated season (`S01 E02`). */
const SEASON_EPISODE_TAG = new RegExp(
  String.raw`\bS(\d{1,2})[\s._-]*E(\d{1,3})(${TAG_TAIL})`,
  'i',
);

const SEASON_EPISODE_TAG_STRIP = new RegExp(
  String.raw`\bS\d{1,2}[\s._-]*E\d{1,3}${TAG_TAIL}`,
  'gi',
);

/**
 * Episodes named by a tag. A `-` range expands to every episode it covers so
 * `{episode}` and re-scans agree on the whole file.
 */
function seasonEpisodeNumbers(match: RegExpExecArray): {
  seasonNumber: number;
  episodeNumbers: number[];
} {
  const seasonNumber = Number(match[1]);
  const numbers = [Number(match[2])];
  const tail = match[3] ?? '';
  for (const item of tail.matchAll(
    /[.\s_-]*-[.\s_-]*E?(\d{1,3})|[._-]?E(\d{1,3})/gi,
  )) {
    const rangeEnd = item[1] ? Number(item[1]) : undefined;
    if (rangeEnd === undefined) {
      numbers.push(Number(item[2]));
      continue;
    }
    const start = numbers[numbers.length - 1];
    if (rangeEnd > start && rangeEnd - start <= 100) {
      for (let number = start + 1; number <= rangeEnd; number += 1) {
        numbers.push(number);
      }
    } else if (rangeEnd <= start) {
      numbers.push(rangeEnd);
    }
  }
  return { seasonNumber, episodeNumbers: [...new Set(numbers)] };
}

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

export function resolutionBucket(
  dimensions: { width?: number; height?: number },
  fallback?: string,
): string | undefined {
  const width =
    dimensions.width && Number.isFinite(dimensions.width)
      ? dimensions.width
      : 0;
  const height =
    dimensions.height && Number.isFinite(dimensions.height)
      ? dimensions.height
      : 0;
  if (width <= 0 && height <= 0) return fallback;
  const floor = 1 - RESOLUTION_TOLERANCE;
  return RESOLUTION_BUCKETS.find(
    ([minWidth, minHeight]) =>
      width >= minWidth * floor || height >= minHeight * floor,
  )?.[2];
}

/** Height-only variant for callers that only know the frame height. */
export function resolutionLabel(
  height: number | undefined,
  fallback?: string,
): string | undefined {
  return resolutionBucket({ height }, fallback);
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
      return { label: resolutionBucket({ width, height }), width, height };
    }
  }
  const explicit =
    /(4320p|2160p|1440p|1080p|720p|576p|480p|8k|4k|2k|uhd)/i.exec(text);
  if (explicit) {
    const value = explicit[1].toLowerCase();
    const height =
      value === '8k' || value === '4320p'
        ? 4320
        : value === '4k' || value === 'uhd' || value === '2160p'
          ? 2160
          : value === '2k' || value === '1440p'
            ? 1440
            : Number(value.replace('p', ''));
    return { label: resolutionBucket({ height }), height };
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
    .replace(/\b(4320p|2160p|1440p|1080p|720p|576p|480p|8k|4k|2k|uhd)\b/gi, ' ')
    .replace(SEASON_EPISODE_TAG_STRIP, ' ')
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
  const tag = SEASON_EPISODE_TAG.exec(base);
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
    const parsedTag = seasonEpisodeNumbers(tag);
    seasonNumber = parsedTag.seasonNumber;
    episodeNumber = parsedTag.episodeNumbers[0];
    episodeNumbers = parsedTag.episodeNumbers;
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

/** Orders episodes by season/episode and drops duplicates. */
export function sortEpisodes(
  episodes: readonly TvdbEpisode[],
): TvdbEpisode[] {
  const seen = new Set<string>();
  return [...episodes]
    .filter((episode) => {
      const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.seasonNumber - right.seasonNumber ||
        left.episodeNumber - right.episodeNumber,
    );
}

function parsedEpisodeNumbers(parsed: ParsedMediaName): number[] {
  if (parsed.episodeNumbers?.length) return parsed.episodeNumbers;
  return parsed.episodeNumber === undefined ? [] : [parsed.episodeNumber];
}

export interface EpisodeRange {
  seasonNumber?: number;
  episodeNumbers: number[];
}

/**
 * The episodes a file covers. An explicit selection wins; otherwise a
 * filename tag such as `S01E02-E03` extends the primary episode into a range.
 */
export function episodeRangeFor(
  episode: TvdbEpisode | undefined,
  parsed: ParsedMediaName | undefined,
  episodes?: readonly TvdbEpisode[],
): EpisodeRange {
  if (episodes && episodes.length > 0) {
    const sorted = sortEpisodes(episodes);
    const seasonNumber = sorted[0].seasonNumber;
    return {
      seasonNumber,
      episodeNumbers: sorted
        .filter((candidate) => candidate.seasonNumber === seasonNumber)
        .map((candidate) => candidate.episodeNumber),
    };
  }
  if (!episode) return { episodeNumbers: [] };
  const numbers = parsed ? parsedEpisodeNumbers(parsed) : [];
  const startsRange =
    parsed?.seasonNumber === episode.seasonNumber &&
    numbers[0] === episode.episodeNumber &&
    numbers.length > 1;
  return {
    seasonNumber: episode.seasonNumber,
    episodeNumbers: startsRange ? numbers : [episode.episodeNumber],
  };
}

/**
 * Plex names multi-episode files with a first/last range (`S01E02-E03`).
 * Non-contiguous selections fall back to concatenated tags so no episode is
 * lost, even though Plex cannot express that shape.
 */
export function episodeRangeTag(
  seasonNumber: number | undefined,
  episodeNumbers: readonly number[],
): string {
  if (seasonNumber === undefined || episodeNumbers.length === 0) return '';
  const first = episodeNumbers[0];
  const start = episodeTag(seasonNumber, first);
  if (episodeNumbers.length === 1) return start;
  const contiguous = episodeNumbers.every(
    (number, index) => index === 0 || number === episodeNumbers[index - 1] + 1,
  );
  if (contiguous) {
    const last = episodeNumbers[episodeNumbers.length - 1];
    return `${start}-E${String(last).padStart(2, '0')}`;
  }
  return `${start}${episodeNumbers
    .slice(1)
    .map((number) => `E${String(number).padStart(2, '0')}`)
    .join('')}`;
}

/** Full display tag for a plan item, including a multi-episode range. */
export function episodeSelectionTag(
  episode: TvdbEpisode | undefined,
  parsed?: ParsedMediaName,
  episodes?: readonly TvdbEpisode[],
): string {
  const range = episodeRangeFor(episode, parsed, episodes);
  return episodeRangeTag(range.seasonNumber, range.episodeNumbers);
}

export function isMediaExtension(extension: string): boolean {
  return MEDIA_EXTENSIONS.has(extension.toLowerCase());
}
