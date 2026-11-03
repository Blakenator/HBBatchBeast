export type MediaType = 'movies' | 'tv';
export type MovieMetadataSource = 'plex' | 'tvdb';

export interface TvdbSeriesRef {
  id: string;
  slug: string;
  name: string;
  year?: number;
  image?: string;
}

export interface TvdbEpisode {
  id?: string;
  /** Display tag such as `S01E02` or `SPECIAL 0x1`. */
  tag: string;
  name: string;
  description?: string;
  seasonNumber: number;
  episodeNumber: number;
  absoluteNumber?: number;
  airDate?: string;
}

export interface TvdbMovie {
  id: string;
  slug: string;
  title: string;
  year?: number;
  overview?: string;
  image?: string;
  imdbId?: string;
  tmdbId?: string;
}

export interface OrganizeSourceFile {
  /** Absolute path. */
  path: string;
  /** Absolute source root this file was discovered under. */
  root: string;
  /** Path relative to `root`, using the host separator. */
  relativePath: string;
  filename: string;
  /** Lower-case without the leading dot. */
  extension: string;
  size: number;
  modifiedAt?: string;
  /** Absolute paths of sidecars that should follow this file. */
  sidecars?: string[];
}

export interface ParsedMediaName {
  /** Best-effort title before sanitisation. */
  title: string;
  /** Normalised title used for comparisons. */
  cleanTitle: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeNumbers?: number[];
  resolution?: string;
  height?: number;
  isSpecial?: boolean;
  airDate?: string;
}

export interface EpisodeCandidate {
  episode: TvdbEpisode;
  score: number;
  confidence: number;
  reason: string;
}

export interface MovieCandidate {
  movie: TvdbMovie;
  score: number;
  confidence: number;
  reason: string;
}

export interface PlexWatchState {
  accountId: number;
  guid: string;
  viewCount: number;
  viewOffset?: number;
  lastViewedAt?: string;
}

export interface PlexAssociation {
  metadataItemId: number;
  mediaItemId: number;
  mediaPartId: number;
  guid: string;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  showId?: number;
  showTitle?: string;
  librarySectionId?: number;
  libraryRoot?: string;
  directoryId?: number;
  directoryPath?: string;
  watchCount: number;
  watchStates: PlexWatchState[];
}

export interface OrganizeSidecar {
  sourcePath: string;
  targetPath: string;
}

export type OrganizeItemAction = 'rename' | 'skip' | 'conflict';

export interface OrganizePlanItem {
  id: string;
  mediaType: MediaType;
  sourcePath: string;
  /** Absolute root the source file was discovered under. */
  sourceRoot: string;
  /** Source path relative to `sourceRoot`, using host separators. */
  sourceRelativePath: string;
  targetPath: string;
  relativeTarget: string;
  action: OrganizeItemAction;
  reason?: string;
  confidence?: number;
  ruleId?: string;
  episode?: TvdbEpisode;
  movie?: TvdbMovie;
  plex?: PlexAssociation;
  sidecars: OrganizeSidecar[];
  /** Filename-derived data the templates rendered with. */
  parsed?: ParsedMediaName;
  /** Display name of the show folder the file was matched through. */
  showFolder?: string;
  /** Show folder relative to the root; `''` when the root is the show. */
  showSubpath?: string;
  /** TVDB show name used for the `{show}` token. */
  seriesName?: string;
  seriesYear?: number;
  /** True when the source and target differ only by case. */
  caseOnly?: boolean;
}

export interface OrganizePlan {
  libraryId?: string;
  mediaType: MediaType;
  sourceRoots: string[];
  items: OrganizePlanItem[];
  createdAt: string;
  /** Non-fatal warnings shown in review. */
  warnings: string[];
}

export interface OrganizeApplyResult {
  planId: string;
  renamed: string[];
  skipped: string[];
  failed: { path: string; message: string }[];
  plexUpdated: number;
  historyMoved: number;
  pendingHistoryTransfers: number;
  warnings: string[];
}

export interface OrganizePlexEnvironment {
  platform: string;
  databaseCandidates: string[];
  serviceKind: 'systemd' | 'launchd' | 'windows-process' | 'manual';
  serviceInstructions: string;
  permissionRemediation?: string;
}

export interface OrganizePlexCheck {
  path: string;
  exists: boolean;
  writable: boolean;
  running: boolean;
  serviceKind: 'systemd' | 'launchd' | 'windows-process' | 'manual';
  serviceInstructions: string;
  permissionRemediation: string;
}

export interface OrganizeJournalSummary {
  planId: string;
  createdAt: string;
  status: 'in-progress' | 'applied' | 'failed';
  mediaType: MediaType;
  moves: {
    sourcePath: string;
    targetPath: string;
    sidecars: { sourcePath: string; targetPath: string }[];
  }[];
  plex?: {
    updated: number;
    historyMoved: number;
    pendingTransfers: number;
    warnings: string[];
    backupPath?: string;
  };
  warning?: string;
}

/** Limits a scan to one show folder of a library. */
export interface OrganizeScanScope {
  folderId: string;
  /** '/'-normalized subpath inside the folder; '' means the whole folder. */
  subpath: string;
  /** Display name shown in the UI. */
  name?: string;
}

export type OrganizeScanPhase = 'discovering' | 'matching' | 'planning';

/** Live scan feedback streamed while the organize plan is built. */
export interface OrganizeScanProgress {
  phase: OrganizeScanPhase;
  /** Files probed and matched so far. */
  completed: number;
  /** Files discovered for matching; 0 until discovery finishes. */
  total: number;
  /** Files found so far; grows during discovery. */
  discovered: number;
  /** File currently being discovered or matched. */
  currentFile?: string;
  /** Show being matched for the current file (TV). */
  currentShow?: string;
  /** Milliseconds since the scan started. */
  elapsedMs: number;
  /** Estimated remaining milliseconds once a rate is known. */
  etaMs?: number;
}

export interface OrganizePendingResult {
  historyMoved: number;
  pendingTransfers: number;
  warnings: string[];
}
