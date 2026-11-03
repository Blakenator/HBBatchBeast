import type {
  MediaType,
  MovieMetadataSource,
  TvdbEpisode,
  TvdbMovie,
  TvdbSeriesRef,
} from './types';

/** Ordered first-match naming rules for the Organize mode. */
export type OrganizeConditionField =
  | 'mediaType'
  | 'path'
  | 'filename'
  | 'extension'
  | 'resolution'
  | 'season'
  | 'episode'
  | 'title'
  | 'year';

export type OrganizeConditionOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'atLeast'
  | 'atMost';

export interface OrganizeRuleCondition {
  field: OrganizeConditionField;
  operator: OrganizeConditionOperator;
  value: string | number;
}

export interface NamingRule {
  id: string;
  name?: string;
  match: 'all' | 'any';
  conditions: OrganizeRuleCondition[];
  fileTemplate: string;
  folderTemplate: string;
}

/**
 * One show folder inside a TV library root. `subpath` is relative to the
 * library source folder; an empty subpath means the source folder itself is the
 * show folder (a single-show library).
 */
export interface TvdbShowMapping {
  id: string;
  folderId: string;
  subpath: string;
  series: TvdbSeriesRef;
  /** Matched from the folder name without the user confirming it. */
  autoMatched?: boolean;
}

/** Per-file match fix chosen in the review table. */
export interface OrganizeMatchOverride {
  series?: TvdbSeriesRef;
  episode?: TvdbEpisode;
  movie?: TvdbMovie;
}

export interface OrganizeSettings {
  /** Movies only. TV uses TVDB by definition. */
  movieMetadata: MovieMetadataSource;
  tvdb?: {
    /** TV only; show folders matched to a series. */
    shows?: TvdbShowMapping[];
    cacheDir?: string;
    apiKey?: string;
  };
  namingRules: NamingRule[];
  confidenceThreshold: number;
  sidecars: 'rename' | 'skip';
  collisions: 'block' | 'suffix';
  caseInsensitive?: boolean;
  cleanupEmptyFolders: boolean;
  renameMovieFolders: boolean;
  /** Manual match fixes keyed by the source file comparison key. */
  overrides?: Record<string, OrganizeMatchOverride>;
}

export const DEFAULT_ORGANIZE_FILE_TEMPLATE = '{title} ({year}) [{resolution}]';
export const DEFAULT_ORGANIZE_FOLDER_TEMPLATE =
  '{title} ({year}) [{resolution}]';
export const DEFAULT_TV_FILE_TEMPLATE = '{tag} - {name}.{ext}';
export const DEFAULT_TV_FOLDER_TEMPLATE = '{show}/Season {season:02}';
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export function createNamingRuleId(): string {
  return `organize-rule-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createNamingRule(
  mediaType: MediaType,
  overrides: Partial<NamingRule> = {},
): NamingRule {
  const isTv = mediaType === 'tv';
  return {
    id: createNamingRuleId(),
    name: isTv ? 'TV default' : 'Movie default',
    match: 'all',
    conditions: [],
    fileTemplate: isTv
      ? DEFAULT_TV_FILE_TEMPLATE
      : DEFAULT_ORGANIZE_FILE_TEMPLATE,
    folderTemplate: isTv
      ? DEFAULT_TV_FOLDER_TEMPLATE
      : DEFAULT_ORGANIZE_FOLDER_TEMPLATE,
    ...overrides,
  };
}

export function defaultNamingRules(mediaType: MediaType): NamingRule[] {
  return [createNamingRule(mediaType)];
}

export function createOrganizeSettings(
  mediaType: MediaType = 'movies',
): OrganizeSettings {
  return {
    movieMetadata: 'tvdb',
    tvdb: { shows: [] },
    namingRules: defaultNamingRules(mediaType),
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    sidecars: 'rename',
    collisions: 'block',
    cleanupEmptyFolders: true,
    renameMovieFolders: true,
    overrides: {},
  };
}

function isShowMapping(value: unknown): value is TvdbShowMapping {
  if (!value || typeof value !== 'object') return false;
  const mapping = value as Partial<TvdbShowMapping>;
  return (
    typeof mapping.id === 'string' &&
    typeof mapping.folderId === 'string' &&
    typeof mapping.subpath === 'string' &&
    Boolean(mapping.series) &&
    typeof mapping.series === 'object' &&
    typeof mapping.series.slug === 'string'
  );
}

function isMatchOverride(value: unknown): value is OrganizeMatchOverride {
  if (!value || typeof value !== 'object') return false;
  const override = value as OrganizeMatchOverride;
  return Boolean(override.series || override.episode || override.movie);
}

/**
 * Shape written by the first organizer build: one series per source folder.
 * Converted once into show mappings keyed by subpath `''`.
 */
function legacyFolderShows(
  seriesByFolder: Record<string, TvdbSeriesRef> | undefined,
): TvdbShowMapping[] {
  if (!seriesByFolder) return [];
  return Object.entries(seriesByFolder).flatMap(([folderId, series]) => {
    if (!folderId || !series || typeof series.slug !== 'string') return [];
    return [
      {
        id: `show-${folderId}`,
        folderId,
        subpath: '',
        series,
      },
    ];
  });
}

/** Fills missing fields from an older or partial persisted value. */
export function resolveOrganizeSettings(
  value: Partial<OrganizeSettings> | undefined,
  mediaType: MediaType = 'movies',
): OrganizeSettings {
  const base = createOrganizeSettings(mediaType);
  const rules = Array.isArray(value?.namingRules)
    ? value.namingRules.filter(
        (rule): rule is NamingRule =>
          Boolean(rule) &&
          typeof rule.id === 'string' &&
          typeof rule.fileTemplate === 'string' &&
          typeof rule.folderTemplate === 'string',
      )
    : [];

  const storedShows = Array.isArray(value?.tvdb?.shows)
    ? value.tvdb.shows.filter(isShowMapping)
    : [];
  const legacy = value?.tvdb as
    | { seriesByFolder?: Record<string, TvdbSeriesRef> }
    | undefined;
  const shows =
    storedShows.length > 0 ? storedShows : legacyFolderShows(legacy?.seriesByFolder);

  const storedOverrides = value?.overrides;
  const overrides: Record<string, OrganizeMatchOverride> =
    storedOverrides && typeof storedOverrides === 'object'
      ? Object.fromEntries(
          Object.entries(storedOverrides).filter(([, entry]) =>
            isMatchOverride(entry),
          ),
        )
      : {};

  return {
    movieMetadata: value?.movieMetadata === 'plex' ? 'plex' : 'tvdb',
    tvdb: {
      shows,
      ...(value?.tvdb?.cacheDir ? { cacheDir: value.tvdb.cacheDir } : {}),
      ...(value?.tvdb?.apiKey ? { apiKey: value.tvdb.apiKey } : {}),
    },
    namingRules: rules.length > 0 ? rules : base.namingRules,
    confidenceThreshold:
      typeof value?.confidenceThreshold === 'number'
        ? Math.min(1, Math.max(0, value.confidenceThreshold))
        : base.confidenceThreshold,
    sidecars: value?.sidecars === 'skip' ? 'skip' : 'rename',
    collisions: value?.collisions === 'suffix' ? 'suffix' : 'block',
    ...(typeof value?.caseInsensitive === 'boolean'
      ? { caseInsensitive: value.caseInsensitive }
      : {}),
    cleanupEmptyFolders: value?.cleanupEmptyFolders !== false,
    renameMovieFolders: value?.renameMovieFolders !== false,
    overrides,
  };
}

/** Convenience for UI copy; not persisted. */
export function hasOrganizeCapability(
  library: { organize?: OrganizeSettings },
): boolean {
  return Boolean(library.organize);
}

export function showMappings(settings: OrganizeSettings): TvdbShowMapping[] {
  return settings.tvdb?.shows ?? [];
}
