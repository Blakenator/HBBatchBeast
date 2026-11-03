/**
 * Template variable metadata for the naming rule editor.
 *
 * The same catalog drives the `{` suggestion popover and the example line under
 * every template field, so the two never disagree about which tokens exist.
 */

import type { MediaType } from './types';

export interface TemplateTokenInfo {
  name: string;
  label: string;
  description: string;
  example: string;
  /** Restricts the token to a media type; omitted means both. */
  mediaTypes?: MediaType[];
}

export const TEMPLATE_TOKENS: TemplateTokenInfo[] = [
  {
    name: 'show',
    label: 'Show name',
    description: 'TVDB series name used for the show folder.',
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
    description: 'Season of the matched episode. Use {season:02} for 01.',
    example: '01',
    mediaTypes: ['tv'],
  },
  {
    name: 'episode',
    label: 'Episode number',
    description: 'Episode number of the match. Use {episode:02} for 02.',
    example: '02',
    mediaTypes: ['tv'],
  },
  {
    name: 'tag',
    label: 'Episode tag',
    description: 'Formatted season/episode tag such as S01E02.',
    example: 'S01E02',
    mediaTypes: ['tv'],
  },
  {
    name: 'name',
    label: 'Episode name',
    description: 'TVDB title of the matched episode.',
    example: 'The Deep',
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
    label: 'Resolution',
    description: 'Video resolution probed from the file.',
    example: '1080p',
  },
  {
    name: 'ext',
    label: 'Extension',
    description: 'File extension without the leading dot.',
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
    seriesYear: 2017,
    season: isTv ? 1 : '',
    episode: isTv ? 2 : '',
    tag: isTv ? 'S01E02' : '',
    name: isTv ? 'The Deep' : '',
    title: isTv ? 'The Deep' : 'Arrival',
    year: isTv ? 2017 : 2016,
    resolution: '1080p',
    ext: 'mkv',
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

const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)(?::(\d+))?\}/g;

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
    (match, name: string, padding: string | undefined) => {
      if (!(name in values)) {
        unknown.add(name);
        return match;
      }
      const value = values[name];
      const raw = String(value);
      if (!padding || !raw) return raw;
      return raw.padStart(Number(padding), '0');
    },
  );
  return { text, unknownTokens: [...unknown] };
}

export type TemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'token'; name: string; padding?: string };

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
      ...(match[2] ? { padding: match[2] } : {}),
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
        : `{${segment.name}${segment.padding ? `:${segment.padding}` : ''}}`,
    )
    .join('');
}

export function formatTokenSnippet(name: string, padding?: string): string {
  return `{${name}${padding ? `:${padding}` : ''}}`;
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
