/**
 * Template variable metadata for the naming rule editor.
 *
 * The same catalog drives the `{` suggestion popover and the example line under
 * every template field, so the two never disagree about which tokens exist.
 *
 * A token may appear more than once with different `format` values; the format
 * is the text after the colon (`{airDate:short}`, `{season:02}`). Numeric
 * formats zero-pad; named formats are listed in `TEMPLATE_VALUE_FORMATTERS`.
 */

import type { MediaType } from './types';

export interface TemplateTokenInfo {
  name: string;
  label: string;
  description: string;
  example: string;
  /** Text after the colon, e.g. `02` or `short`. */
  format?: string;
  /** Restricts the token to a media type; omitted means both. */
  mediaTypes?: MediaType[];
}

export const TEMPLATE_TOKENS: TemplateTokenInfo[] = [
  {
    name: 'show',
    label: 'Show name',
    description:
      'TVDB series name used for the show folder. Also accepts {seriesName}.',
    example: 'Blue Planet II',
    mediaTypes: ['tv'],
  },
  {
    name: 'seriesYear',
    label: 'Show year',
    description: 'First-release year of the matched series.',
    example: '2017',
    mediaTypes: ['tv'],
  },
  {
    name: 'season',
    label: 'Season number',
    description:
      'Season of the matched episode, unpadded. Pick the zero-padded variant for 01.',
    example: '1',
    mediaTypes: ['tv'],
  },
  {
    name: 'season',
    label: 'Season number (zero-padded)',
    description: 'Season padded to two digits.',
    example: '01',
    format: '02',
    mediaTypes: ['tv'],
  },
  {
    name: 'episode',
    label: 'Episode number',
    description:
      'Episode number of the match, unpadded. Pick the zero-padded variant for 02.',
    example: '2',
    mediaTypes: ['tv'],
  },
  {
    name: 'episode',
    label: 'Episode number (zero-padded)',
    description: 'Episode padded to two digits.',
    example: '02',
    format: '02',
    mediaTypes: ['tv'],
  },
  {
    name: 'episodeEnd',
    label: 'Last episode number',
    description:
      'Last episode when the file is a multi-episode release, otherwise empty.',
    example: '3',
    mediaTypes: ['tv'],
  },
  {
    name: 'episodeEnd',
    label: 'Last episode number (zero-padded)',
    description: 'Multi-episode end number padded to two digits.',
    example: '03',
    format: '02',
    mediaTypes: ['tv'],
  },
  {
    name: 'tag',
    label: 'Episode tag',
    description:
      'Formatted season/episode tag such as S01E02. Also accepts {episodeTag}.',
    example: 'S01E02',
    mediaTypes: ['tv'],
  },
  {
    name: 'name',
    label: 'Episode name',
    description:
      'TVDB title of the matched episode. Also accepts {episodeName}.',
    example: 'The Deep',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air date',
    description:
      'Air date as YYYY-MM-DD. Variants: {airDate:short} (YYYY-MM), :year, :month, :day, :compact (YYYYMMDD), :dot (YYYY.MM.DD).',
    example: '2017-10-29',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air date (year-month)',
    description: 'Air date shortened to YYYY-MM.',
    example: '2017-10',
    format: 'short',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air year',
    description: 'Four-digit air year.',
    example: '2017',
    format: 'year',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air month',
    description: 'Two-digit air month.',
    example: '10',
    format: 'month',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air day',
    description: 'Two-digit air day.',
    example: '29',
    format: 'day',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air date (compact)',
    description: 'Air date as YYYYMMDD.',
    example: '20171029',
    format: 'compact',
    mediaTypes: ['tv'],
  },
  {
    name: 'airDate',
    label: 'Air date (dotted)',
    description: 'Air date as YYYY.MM.DD.',
    example: '2017.10.29',
    format: 'dot',
    mediaTypes: ['tv'],
  },
  {
    name: 'title',
    label: 'Title',
    description: 'Movie title, or the episode name for TV.',
    example: 'Arrival',
  },
  {
    name: 'year',
    label: 'Year',
    description: 'Movie release year, or the episode air year.',
    example: '2016',
  },
  {
    name: 'resolution',
    label: 'Resolution bucket',
    description:
      'Resolution label such as 1080p, 4K, 576p or SD. Also accepts {resolutionBucket}.',
    example: '1080p',
  },
  {
    name: 'width',
    label: 'Frame width',
    description: 'Frame width in pixels, from ffprobe or Plex.',
    example: '1920',
  },
  {
    name: 'height',
    label: 'Frame height',
    description: 'Frame height in pixels, from ffprobe or Plex.',
    example: '1080',
  },
  {
    name: 'ext',
    label: 'Extension',
    description:
      'File extension without the leading dot. Also accepts {extension}.',
    example: 'mkv',
  },
  {
    name: 'filename',
    label: 'Original filename',
    description: 'Source file name including its extension.',
    example: 'Blue.Planet.II.S01E02.1080p.mkv',
  },
  {
    name: 'mediaType',
    label: 'Media type',
    description: 'movies or tv.',
    example: 'tv',
  },
  {
    name: 'path',
    label: 'Source path',
    description: 'Absolute path of the source file.',
    example: '/media/tv/Blue Planet II/Blue.Planet.II.S01E02.1080p.mkv',
  },
  {
    name: 'slug',
    label: 'Movie slug',
    description: 'TVDB slug for the matched movie.',
    example: 'arrival',
    mediaTypes: ['movies'],
  },
  {
    name: 'imdbId',
    label: 'IMDB id',
    description: 'IMDB id of the matched movie.',
    example: 'tt2543164',
    mediaTypes: ['movies'],
  },
  {
    name: 'tmdbId',
    label: 'TMDB id',
    description: 'TheMovieDB id of the matched movie.',
    example: '329865',
    mediaTypes: ['movies'],
  },
];

type TokenValueFormatter = (value: string) => string;

/** Named (non-numeric) formats, keyed by token name then format. */
const TEMPLATE_VALUE_FORMATTERS: Record<
  string,
  Record<string, TokenValueFormatter>
> = {
  airDate: {
    short: (value) => value.slice(0, 7),
    year: (value) => value.slice(0, 4),
    month: (value) => value.slice(5, 7),
    day: (value) => value.slice(8, 10),
    compact: (value) => value.replace(/-/g, ''),
    dot: (value) => value.replace(/-/g, '.'),
  },
};

/**
 * Applies a numeric padding or named format to a token value. Returns
 * `undefined` when the format is not known for that token.
 */
export function formatTemplateValue(
  name: string,
  format: string | undefined,
  value: string | number | undefined,
): string | undefined {
  const text = value === undefined || value === null ? '' : String(value);
  if (!format) return text;
  if (/^\d+$/.test(format)) return text.padStart(Number(format), '0');
  const formatter = TEMPLATE_VALUE_FORMATTERS[name]?.[format];
  return formatter ? formatter(text) : undefined;
}

export function templateTokenCatalog(
  mediaType: MediaType,
): TemplateTokenInfo[] {
  return TEMPLATE_TOKENS.filter(
    (token) => !token.mediaTypes || token.mediaTypes.includes(mediaType),
  );
}

export function exampleTemplateValues(
  mediaType: MediaType,
): Record<string, string | number> {
  const isTv = mediaType === 'tv';
  return {
    show: 'Blue Planet II',
    seriesName: 'Blue Planet II',
    seriesYear: 2017,
    season: isTv ? 1 : '',
    episode: isTv ? 2 : '',
    episodeEnd: isTv ? 3 : '',
    tag: isTv ? 'S01E02' : '',
    episodeTag: isTv ? 'S01E02' : '',
    name: isTv ? 'The Deep' : '',
    episodeName: isTv ? 'The Deep' : '',
    title: isTv ? 'The Deep' : 'Arrival',
    year: isTv ? 2017 : 2016,
    resolution: '1080p',
    resolutionBucket: '1080p',
    width: 1920,
    height: 1080,
    airDate: isTv ? '2017-10-29' : '',
    ext: 'mkv',
    extension: 'mkv',
    filename: isTv
      ? 'Blue.Planet.II.S01E02.One.Ocean.mkv'
      : 'Arrival.2016.1080p.BluRay.mkv',
    mediaType,
    path: isTv
      ? '/media/tv/Blue Planet II/Blue.Planet.II.S01E02.One.Ocean.mkv'
      : '/media/movies/Arrival.2016.1080p.BluRay.mkv',
    slug: isTv ? 'blue-planet-ii' : 'arrival',
    imdbId: isTv ? 'tt5491994' : 'tt2543164',
    tmdbId: isTv ? '73913' : '329865',
  };
}

const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)(?::([a-zA-Z][a-zA-Z0-9_]*|\d+))?\}/g;

export interface TemplateRenderExample {
  text: string;
  unknownTokens: string[];
}

/**
 * Renders a template with example data. Unknown variables are left in place
 * (and reported) so a half-typed template never breaks the editor.
 */
export function renderTemplateExample(
  template: string,
  mediaType: MediaType,
): TemplateRenderExample {
  const values = exampleTemplateValues(mediaType);
  const unknown = new Set<string>();
  const text = template.replace(
    TOKEN_PATTERN,
    (match, name: string, format: string | undefined) => {
      if (!(name in values)) {
        unknown.add(name);
        return match;
      }
      const formatted = formatTemplateValue(name, format, values[name]);
      if (formatted === undefined) {
        unknown.add(format ? `${name}:${format}` : name);
        return match;
      }
      return formatted;
    },
  );
  return { text, unknownTokens: [...unknown] };
}

export type TemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'token'; name: string; format?: string };

/** Splits a template string into literal text and variable segments. */
export function parseTemplateSegments(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: 'text', text: template.slice(lastIndex, index) });
    }
    segments.push({
      kind: 'token',
      name: match[1],
      ...(match[2] ? { format: match[2] } : {}),
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < template.length) {
    segments.push({ kind: 'text', text: template.slice(lastIndex) });
  }
  return segments;
}

export function serializeTemplateSegments(
  segments: TemplateSegment[],
): string {
  return segments
    .map((segment) =>
      segment.kind === 'text'
        ? segment.text
        : `{${segment.name}${segment.format ? `:${segment.format}` : ''}}`,
    )
    .join('');
}

export function formatTokenSnippet(name: string, format?: string): string {
  return `{${name}${format ? `:${format}` : ''}}`;
}

/** The `{partial` the caret is inside, if any (used to open the popover). */
export function tokenQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('{');
  if (open < 0) return undefined;
  const query = before.slice(open + 1);
  if (query.includes('}') || /[\s/\\]/.test(query)) return undefined;
  return { start: open, query };
}
