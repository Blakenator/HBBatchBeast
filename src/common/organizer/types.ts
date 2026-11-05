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
  /**
   * Cleaned text after the matched tag, when the filename provides one.
   * `Blue.Planet.II.S01E02.The.Deep.mkv` → `The Deep`.
   */
  episodeTitle?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeNumbers?: number[];
  resolution?: string;
  width?: number;
  height?: number;
  isSpecial?: boolean;
  airDate?: string;
}

export type EpisodeAxisState = 'missing' | 'incorrect' | 'correct';

export type EpisodeMatchComponentKind = 'tag' | 'name' | 'airDate';

/** One weighted input to an episode match; also what the badge popover shows. */
export interface EpisodeMatchComponent {
  kind: EpisodeMatchComponentKind;
  /** Configured weight; all weights sum to 1. */
  weight: number;
  present: boolean;
  state: EpisodeAxisState;
  /** Only for the name component. */
  similarity?: number;
  /** 0..1 when present, absent when the signal was missing. */
  componentScore?: number;
  /** componentScore * weight, or 0 when missing. */
  contribution: number;
  detail: string;
}

export interface EpisodeMatchEvidence {
  tag: EpisodeAxisState;
  name: EpisodeAxisState;
  nameSimilarity: number;
  nameText?: string;
  airDateMatch: boolean;
  components: EpisodeMatchComponent[];
  /** Sum of weights for signals that were present (0..1). */
  coverage: number;
  /** Weighted component score before the coverage/calibration multiplier. */
  rawScore: number;
  /** Weighted confidence before any conflict/ambiguity cap. */
  confidenceBeforeCap: number;
  /** Conflict or ambiguity cap applied to the final confidence. */
  cap?: number;
}

export type EpisodeConflictKind =
  | 'tag-vs-name'
  | 'tag-vs-air-date'
  | 'name-vs-air-date'
  | 'tag-name-air-date'
  | 'ambiguous-name';

/** Evidence persisted on a plan item for the review table and badge popover. */
export interface EpisodeMatchSummary extends EpisodeMatchEvidence {
  conflict: boolean;
  conflictKind?: EpisodeConflictKind;
  conflictReason?: string;
  /** Episode tags each signal pointed at when they disagreed. */
  suggestedTags?: { tag?: string; name?: string; airDate?: string };
}

export interface EpisodeCandidate {
  episode: TvdbEpisode;
  score: number;
  confidence: number;
  reason: string;
  evidence: EpisodeMatchEvidence;
}

export interface EpisodeResolution {
  episode?: TvdbEpisode;
  candidate?: EpisodeCandidate;
  confidence: number;
  reason: string;
  summary?: EpisodeMatchSummary;
  conflict: boolean;
  conflictKind?: EpisodeConflictKind;
  conflictReason?: string;
  tagCandidate?: EpisodeCandidate;
  nameCandidate?: EpisodeCandidate;
  airDateCandidate?: EpisodeCandidate;
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
  /** Plex `originally_available_at`, reduced to YYYY-MM-DD. */
  airDate?: string;
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
  /** Primary (first) episode of the match. */
  episode?: TvdbEpisode;
  /** Every episode the file contains when it is a multi-episode release. */
  episodes?: TvdbEpisode[];
  movie?: TvdbMovie;
  plex?: PlexAssociation;
  /** Every Plex episode association that shares the file's path. */
  plexEpisodes?: PlexAssociation[];
  /** Tag/title/air-date evidence behind an episode match. */
  episodeMatch?: EpisodeMatchSummary;
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
  /** True when only the folder changes and the file name is already correct. */
  folderOnly?: boolean;
  /** True when the rendered target path is already the source path. */
  noChange?: boolean;
  /** True when the user explicitly skipped this file for the current review. */
  manualSkip?: boolean;
  /**
   * True when the user approved the current match. Approved rows stay renames
   * across replans even when their confidence is below the threshold.
   */
  approved?: boolean;
  /**
   * True when the user asked to keep the source file name and only apply the
   * rendered folder, so the templates still move the file without renaming it.
   */
  renameFolderOnly?: boolean;
}

export interface OrganizePlan {
  libraryId?: string;
  mediaType: MediaType;
  sourceRoots: string[];
  items: OrganizePlanItem[];
  createdAt: string;
  /** Non-fatal warnings shown in review. */
  warnings: string[];
  /** Opaque backend token for reprocessing without walking the folders again. */
  scanId?: string;
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

export type PlexServiceKind =
  | 'systemd'
  | 'launchd'
  | 'windows-process'
  | 'manual';

export type PlexIssueSeverity = 'error' | 'warning' | 'info';

export type PlexIssueId =
  | 'database-missing'
  | 'database-not-writable'
  | 'database-folder-not-writable'
  | 'service-running'
  | 'service-unknown';

export interface PlexIssue {
  id: PlexIssueId;
  severity: PlexIssueSeverity;
  title: string;
  detail: string;
  /** Whether the automatic fix includes a step for this issue. */
  fixable: boolean;
}

export type PlexFixStepId = 'stop-service' | 'grant-access' | 'start-service';

export interface PlexRemediationStep {
  id: PlexFixStepId;
  title: string;
  /** Complete command(s) for the host platform, newline separated. */
  command: string;
}

export interface PlexRemediation {
  summary: string;
  steps: PlexRemediationStep[];
  /** Steps joined into one script for the copyable code block. */
  script: string;
}

export interface PlexFixStep {
  id: PlexFixStepId;
  title: string;
  ok: boolean;
  detail?: string;
}

export interface OrganizePlexEnvironment {
  platform: string;
  databaseCandidates: string[];
  serviceKind: PlexServiceKind;
}

export interface OrganizePlexCheck {
  path: string;
  exists: boolean;
  /** True when both the database and the folder holding its journal are writable. */
  writable: boolean;
  /** Whether SQLite can create `-wal`, `-shm` and journal files next to it. */
  folderWritable?: boolean;
  running: boolean;
  serviceKind: PlexServiceKind;
  issues: PlexIssue[];
  remediation: PlexRemediation;
  /** True when this platform can offer a one-click fix. */
  canAutoFix: boolean;
}

export interface OrganizePlexFixResult {
  check: OrganizePlexCheck;
  steps: PlexFixStep[];
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
