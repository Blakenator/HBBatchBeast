import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { move } from 'fs-extra';
import type { AppPaths } from '../helpers/appPaths';
import { probeMedia as defaultProbeMedia } from '../helpers/probeMedia';
import type { Library } from '../../common/library';
import type {
  EpisodeResolution,
  OrganizeApplyResult,
  OrganizePlan,
  OrganizeSourceFile,
  ParsedMediaName,
  OrganizeScanProgress,
  OrganizeScanScope,
  MediaType,
  PlexAssociation,
  TvdbEpisode,
  TvdbMovie,
  TvdbSeriesRef,
} from '../../common/organizer/types';
import type {
  OrganizeMatchOverride,
  OrganizeSettings,
} from '../../common/organizer/settings';
import {
  buildOrganizePlan,
  isCaseInsensitivePlatform,
  organizerComparisonKey,
  findShowMapping,
  overrideFor,
  applyNameReplacements,
  parseMediaFilenameWithReplacements,
  pickBestSeries,
  guessSeriesQuery,
  normalizeSubpath,
  rankMovies,
  resolutionBucket,
  resolveEpisode,
  resolveOrganizeSettings,
  resolveShowMapping,
  sortEpisodes,
  episodeRangeFor,
  type DetectedShow,
  type PlannedFileInput,
} from '../../common/organizer';
import { expandHomePath, isPathInside } from '../../common/pathUtils';
import { SIDECAR_EXTENSIONS, isMediaExtension } from '../../common/organizer/filename';
import { TvdbClient } from './tvdb/client';
import { mapWithConcurrency } from './concurrency';
import {
  loadPlexCatalog,
  type PlexCatalog,
  type PlexEpisodeFile,
  type PlexMovieFile,
} from './plex/catalog';
import { plexAccessState, plexRemediation } from './plex/remediation';
import { detectPlexService } from './plex/service';
import {
  completePendingHistoryTransfers,
  updatePlexFromPlan,
  type PlexUpdateResult,
} from './plex/writer';

function plexUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERPROFILE ?? 'your user';
  }
}

const SKIPPED_DIRECTORIES = new Set([
  '@eaDir',
  '#recycle',
  '.git',
  'node_modules',
  'System Volume Information',
]);

export interface OrganizePlanOptions {
  library: Library;
  settings?: OrganizeSettings;
  appPaths: AppPaths;
  platform?: NodeJS.Platform;
  home?: string;
  tvdbClient?: TvdbClient;
  catalog?: PlexCatalog;
  probeMedia?: (filePath: string) => Promise<ProbeDimensions>;
  /** Global Plex database path, independent of the library. */
  plexDbPath?: string;
  /** Receives throttled live progress while the plan is built. */
  onProgress?: (progress: OrganizeScanProgress) => void;
  /** Restricts the scan to the selected show folders. */
  scope?: OrganizeScanScope[];
  /** Reuses discovery/probe results from an earlier scan instead of walking. */
  reuseScanId?: string;
  /**
   * Absolute folders to walk again for a partial rescan. Matching and planning
   * are limited to the files found there, so the caller can splice the result
   * into an existing plan.
   */
  rescanFolders?: string[];
  /** Bounds parallel file probing/matching; defaults to the CPU-derived cap. */
  matchConcurrency?: number;
}

interface OrganizeScanCache {
  id: string;
  libraryId: string;
  mediaType: MediaType;
  scopeKey: string;
  files: OrganizeSourceFile[];
  roots: string[];
  warnings: string[];
  probeCache: Map<string, ProbeDimensions>;
  createdAt: number;
}

const scanCaches = new Map<string, OrganizeScanCache>();
const MAX_SCAN_CACHES = 8;

function defaultMatchConcurrency(): number {
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
  return Math.max(2, Math.min(8, cpus));
}

function scopeKey(scope?: OrganizeScanScope[]): string {
  return JSON.stringify(
    (scope ?? [])
      .map((entry) => ({
        folderId: entry.folderId,
        subpath: entry.subpath,
      }))
      .sort((left, right) =>
        `${left.folderId}:${left.subpath}`.localeCompare(
          `${right.folderId}:${right.subpath}`,
        ),
      ),
  );
}

function rememberScanCache(cache: OrganizeScanCache): void {
  scanCaches.set(cache.id, cache);
  const entries = [...scanCaches.values()].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
  for (const stale of entries.slice(0, Math.max(0, entries.length - MAX_SCAN_CACHES))) {
    scanCaches.delete(stale.id);
  }
}

export interface OrganizeApplyOptions {
  plan: OrganizePlan;
  settings: OrganizeSettings;
  appPaths: AppPaths;
  platform?: NodeJS.Platform;
  updatePlex: boolean;
  plexDbPath?: string;
}

export interface OrganizeJournalMove {
  sourcePath: string;
  targetPath: string;
  sidecars: { sourcePath: string; targetPath: string }[];
}

export interface OrganizeJournal {
  planId: string;
  createdAt: string;
  status: 'in-progress' | 'applied' | 'failed';
  mediaType: OrganizePlan['mediaType'];
  moves: OrganizeJournalMove[];
  plex?: PlexUpdateResult;
  warning?: string;
}

function journalPath(appPaths: AppPaths): string {
  return path.join(appPaths.configDir, 'organize-journal.json');
}

function pendingPath(appPaths: AppPaths): string {
  return path.join(appPaths.configDir, 'organize-pending.json');
}

function writeJournal(appPaths: AppPaths, journal: OrganizeJournal): void {
  fs.mkdirSync(appPaths.configDir, { recursive: true });
  fs.writeFileSync(journalPath(appPaths), JSON.stringify(journal, null, 2), 'utf8');
}

export function readOrganizeJournal(
  appPaths: AppPaths,
): OrganizeJournal | undefined {
  try {
    const file = journalPath(appPaths);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as OrganizeJournal;
  } catch {
    return undefined;
  }
}

function associationFromMovie(movie: PlexMovieFile): PlexAssociation {
  return {
    metadataItemId: movie.metadataItemId,
    mediaItemId: movie.mediaItemId,
    mediaPartId: movie.mediaPartId,
    guid: movie.guid,
    title: movie.title,
    ...(movie.librarySectionId
      ? { librarySectionId: movie.librarySectionId }
      : {}),
    libraryRoot: movie.libraryRoot,
    ...(movie.airDate ? { airDate: movie.airDate } : {}),
    ...(movie.directoryId ? { directoryId: movie.directoryId } : {}),
    ...(movie.directoryPath ? { directoryPath: movie.directoryPath } : {}),
    watchCount: movie.watchCount,
    watchStates: movie.watchStates,
  };
}

function associationFromEpisode(episode: PlexEpisodeFile): PlexAssociation {
  return {
    metadataItemId: episode.metadataItemId,
    mediaItemId: episode.mediaItemId,
    mediaPartId: episode.mediaPartId,
    guid: episode.guid,
    title: episode.episodeTitle,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    showId: episode.showId,
    showTitle: episode.showTitle,
    ...(episode.librarySectionId
      ? { librarySectionId: episode.librarySectionId }
      : {}),
    libraryRoot: episode.libraryRoot,
    ...(episode.airDate ? { airDate: episode.airDate } : {}),
    ...(episode.directoryId ? { directoryId: episode.directoryId } : {}),
    ...(episode.directoryPath
      ? { directoryPath: episode.directoryPath }
      : {}),
    watchCount: episode.watchCount,
    watchStates: episode.watchStates,
  };
}

function findMovieAssociation(
  files: PlexMovieFile[],
  filePath: string,
  caseInsensitive: boolean,
): PlexMovieFile | undefined {
  return files.find(
    (file) =>
      organizerComparisonKey(file.file, { caseInsensitive }) ===
      organizerComparisonKey(filePath, { caseInsensitive }),
  );
}

/**
 * TVDB episodes for every episode a filename tag covers, so a multi-episode
 * file can show and name all of its titles.
 */
function episodesForRange(
  episodes: TvdbEpisode[],
  primary: TvdbEpisode | undefined,
  parsed: ParsedMediaName,
): TvdbEpisode[] | undefined {
  if (!primary) return undefined;
  const range = episodeRangeFor(primary, parsed);
  if (range.episodeNumbers.length < 2) return undefined;
  const byNumber = new Map(
    episodes
      .filter((episode) => episode.seasonNumber === range.seasonNumber)
      .map((episode) => [episode.episodeNumber, episode]),
  );
  const selected = range.episodeNumbers.flatMap((number) => {
    const match = byNumber.get(number);
    return match ? [match] : [];
  });
  return selected.length > 1 ? selected : undefined;
}

function findEpisodeAssociations(
  files: PlexEpisodeFile[],
  filePath: string,
  caseInsensitive: boolean,
): PlexEpisodeFile[] {
  const pathKey = organizerComparisonKey(filePath, { caseInsensitive });
  return files
    .filter(
      (file) =>
        organizerComparisonKey(file.file, { caseInsensitive }) === pathKey,
    )
    .sort(
      (left, right) =>
        left.seasonNumber - right.seasonNumber ||
        left.episodeNumber - right.episodeNumber ||
        left.mediaPartId - right.mediaPartId,
    );
}

async function walkDirectory(
  root: string,
  directory: string,
  media: OrganizeSourceFile[],
  sidecars: Map<string, string[]>,
  onMedia?: (path: string) => void,
): Promise<void> {
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await walkDirectory(root, absolute, media, sidecars, onMedia);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name === 'desktop.ini') {
      continue;
    }
    if (entry.name.startsWith('._')) continue;
    const extension = entry.name.includes('.')
      ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
      : '';
    const relativePath = path.relative(root, absolute);
    if (isMediaExtension(extension)) {
      media.push({
        path: absolute,
        root,
        relativePath,
        filename: entry.name,
        extension,
        size: 0,
      });
      onMedia?.(absolute);
    } else if (SIDECAR_EXTENSIONS.has(extension)) {
      const key = `${path.dirname(absolute)}${path.sep}${entry.name
        .slice(0, entry.name.lastIndexOf('.'))
        .toLowerCase()}`;
      const list = sidecars.get(key) ?? [];
      list.push(absolute);
      sidecars.set(key, list);
    }
  }
}

function attachSidecars(
  media: OrganizeSourceFile[],
  sidecars: Map<string, string[]>,
): void {
  for (const file of media) {
    const base = file.filename.slice(0, file.filename.lastIndexOf('.'));
    const directory = path.dirname(file.path);
    const prefix = `${directory}${path.sep}${base.toLowerCase()}`;
    const matches = [...sidecars.entries()]
      .filter(([key]) => key === prefix || key.startsWith(`${prefix}.`))
      .flatMap(([, paths]) => paths);
    if (matches.length > 0) file.sidecars = matches;
  }
}

/**
 * Maps absolute folders onto the library structure so a partial rescan walks
 * exactly those folders (and anything nested inside them).
 */
function scopeForRescanFolders(
  library: Library,
  folders: string[],
  home: string,
): OrganizeScanScope[] | undefined {
  const targets = folders
    .map((folder) => folder.trim())
    .filter(Boolean)
    .map((folder) => path.resolve(expandHomePath(folder, home)));
  if (targets.length === 0) return undefined;
  const scope: OrganizeScanScope[] = [];
  for (const folder of library.folders) {
    const source = expandHomePath(folder.source, home).trim();
    if (!source) continue;
    const root = path.resolve(source);
    for (const target of targets) {
      if (!isPathInside(target, root)) continue;
      scope.push({
        folderId: folder.id,
        subpath: normalizeSubpath(path.relative(root, target)),
      });
    }
  }
  return scope.length > 0 ? scope : undefined;
}

async function scanLibraryFiles(
  library: Library,
  home: string,
  onDiscovered?: (discovered: number, currentFile: string) => void,
  scope?: OrganizeScanScope[],
): Promise<{ files: OrganizeSourceFile[]; warnings: string[]; roots: string[] }> {  const files: OrganizeSourceFile[] = [];
  const warnings: string[] = [];
  const roots: string[] = [];
  const selected = scope && scope.length > 0 ? scope : undefined;

  if (selected) {
    const known = new Set(library.folders.map((folder) => folder.id));
    for (const show of selected) {
      if (!known.has(show.folderId)) {
        warnings.push(
          `The selected show "${show.name ?? show.subpath}" is no longer part of this library.`,
        );
      }
    }
  }

  for (const folder of library.folders) {
    const selectedShows = selected?.filter(
      (show) => show.folderId === folder.id,
    );
    if (selected && (!selectedShows || selectedShows.length === 0)) continue;

    const source = expandHomePath(folder.source, home).trim();
    if (!source) continue;
    const root = path.resolve(source);
    if (!fs.existsSync(root)) {
      warnings.push(`Source folder does not exist: ${root}`);
      continue;
    }

    // Selecting a parent and one of its shows would walk those files twice.
    const subpaths = (selectedShows ?? [{ folderId: folder.id, subpath: '' }])
      .map((show) => normalizeSubpath(show.subpath))
      .filter(
        (subpath, index, all) =>
          !all.some(
            (other, otherIndex) =>
              otherIndex !== index &&
              other !== subpath &&
              (other === '' || subpath.startsWith(`${other}/`)),
          ),
      );

    let addedRoot = false;
    for (const subpath of subpaths) {
      const walkRoot = subpath ? path.join(root, ...subpath.split('/')) : root;
      if (!fs.existsSync(walkRoot)) {
        warnings.push(`Show folder does not exist: ${walkRoot}`);
        continue;
      }
      if (!addedRoot) {
        roots.push(root);
        addedRoot = true;
      }
      const media: OrganizeSourceFile[] = [];
      const sidecars = new Map<string, string[]>();
      await walkDirectory(root, walkRoot, media, sidecars, (found) =>
        onDiscovered?.(files.length + media.length, found),
      );
      attachSidecars(media, sidecars);
      files.push(...media);
    }
  }
  return { files, warnings, roots };
}

async function countMediaFiles(
  directory: string,
  recursive: boolean,
): Promise<number> {
  let count = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !SKIPPED_DIRECTORIES.has(entry.name)) {
          pending.push(absolute);
        }
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('._')) continue;
      const extension = entry.name.includes('.')
        ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
        : '';
      if (isMediaExtension(extension)) count += 1;
    }
  }
  return count;
}

/**
 * Lists the show folders of a TV library. A source folder that directly holds
 * media is itself a show (`subpath: ''`); otherwise each first-level folder
 * with media is a show. Unmapped folders are matched to TVDB by folder name.
 */
export async function detectShowFolders(options: {
  library: Library;
  settings?: OrganizeSettings;
  home?: string;
  tvdbClient: TvdbClient;
}): Promise<{ folders: DetectedShow[]; warnings: string[] }> {
  const settings = resolveOrganizeSettings(
    options.settings ?? options.library.organize,
    options.library.mediaType,
  );
  const home = options.home ?? '';
  const replacements = settings.nameReplacements ?? [];
  const warnings: string[] = [];

  interface PendingShow {
    folderId: string;
    root: string;
    subpath: string;
    name: string;
    mediaCount: number;
    query: string;
  }
  type Entry =
    | { kind: 'ready'; show: DetectedShow }
    | { kind: 'pending'; show: PendingShow };

  const entries: Entry[] = [];
  for (const folder of options.library.folders) {
    const source = expandHomePath(folder.source, home).trim();
    if (!source) continue;
    const root = path.resolve(source);
    if (!fs.existsSync(root)) {
      warnings.push(`Source folder does not exist: ${root}`);
      continue;
    }

    // The whole folder can be declared a single show; nested mappings would
    // otherwise win, so detection reports the root only.
    const rootMapping = findShowMapping(settings, folder.id, '');
    if (rootMapping) {
      entries.push({
        kind: 'ready',
        show: {
          folderId: folder.id,
          root,
          subpath: '',
          name: path.basename(root),
          mediaCount: await countMediaFiles(root, true),
          series: rootMapping.series,
          query: guessSeriesQuery(
            applyNameReplacements(path.basename(root), replacements),
          ).query,
        },
      });
      continue;
    }

    const shows: { subpath: string; name: string; mediaCount: number }[] = [];
    const direct = await countMediaFiles(root, false);
    if (direct > 0) {
      shows.push({ subpath: '', name: path.basename(root), mediaCount: direct });
    } else {
      let directoryEntries: import('fs').Dirent[];
      try {
        directoryEntries = await fs.promises.readdir(root, {
          withFileTypes: true,
        });
      } catch {
        directoryEntries = [];
      }
      for (const entry of directoryEntries) {
        if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        const mediaCount = await countMediaFiles(
          path.join(root, entry.name),
          true,
        );
        if (mediaCount === 0) continue;
        shows.push({
          subpath: entry.name,
          name: entry.name,
          mediaCount,
        });
      }
    }
    if (shows.length === 0) {
      warnings.push(`No media files found under ${root}.`);
    }

    for (const show of shows) {
      const guess = guessSeriesQuery(
        applyNameReplacements(show.name, replacements),
      );
      const existing = findShowMapping(settings, folder.id, show.subpath);
      if (existing) {
        entries.push({
          kind: 'ready',
          show: {
            folderId: folder.id,
            root,
            ...show,
            series: existing.series,
            query: guess.query,
          },
        });
        continue;
      }
      entries.push({
        kind: 'pending',
        show: {
          folderId: folder.id,
          root,
          ...show,
          query: guess.query,
        },
      });
    }
  }

  const pending = entries.flatMap((entry) =>
    entry.kind === 'pending' ? [entry.show] : [],
  );
  const candidatesByIndex: TvdbSeriesRef[][] = [];
  const searchErrors = new Map<number, string>();
  if (pending.length > 0) {
    try {
      const searched = await options.tvdbClient.searchMany(
        pending.map((show) => show.query),
      );
      for (const [index, result] of searched.entries()) {
        candidatesByIndex[index] = result.series;
      }
    } catch {
      // One failed batch must not abort detection; retry each query on its own.
      for (const [index, show] of pending.entries()) {
        try {
          candidatesByIndex[index] = await options.tvdbClient.searchSeries(
            show.query,
          );
        } catch (error) {
          searchErrors.set(
            index,
            error instanceof Error ? error.message : String(error),
          );
          candidatesByIndex[index] = [];
        }
      }
    }
  }

  const folders: DetectedShow[] = [];
  let pendingIndex = 0;
  for (const entry of entries) {
    if (entry.kind === 'ready') {
      folders.push(entry.show);
      continue;
    }
    const index = pendingIndex;
    pendingIndex += 1;
    const show = entry.show;
    const error = searchErrors.get(index);
    if (error) {
      warnings.push(`${show.name}: TVDB search failed (${error}).`);
      folders.push({
        folderId: show.folderId,
        root: show.root,
        subpath: show.subpath,
        name: show.name,
        mediaCount: show.mediaCount,
        query: show.query,
      });
      continue;
    }
    const candidates = candidatesByIndex[index] ?? [];
    const guess = guessSeriesQuery(
      applyNameReplacements(show.name, replacements),
    );
    const match = pickBestSeries(candidates, guess);
    folders.push({
      folderId: show.folderId,
      root: show.root,
      subpath: show.subpath,
      name: show.name,
      mediaCount: show.mediaCount,
      query: show.query,
      candidates: candidates.slice(0, 8),
      ...(match ? { series: match.series, autoMatched: true } : {}),
    });
  }

  return { folders, warnings };
}

interface ProbeDimensions {
  width?: number;
  height?: number;
}

function parsedWithProbe(
  parsed: ParsedMediaName,
  dimensions: ProbeDimensions,
): ParsedMediaName {
  if (!dimensions.width && !dimensions.height) return parsed;
  return withProbeResolution(parsed, dimensions);
}

/** ffprobe or Plex is authoritative; the filename is only a fallback. */
function withProbeResolution(
  parsed: ParsedMediaName,
  dimensions: ProbeDimensions,
): ParsedMediaName {
  const width = dimensions.width ?? parsed.width;
  const height = dimensions.height ?? parsed.height;
  if (!width && !height) return parsed;
  const bucket = resolutionBucket({ width, height });
  return {
    ...parsed,
    ...(bucket ? { resolution: bucket } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
}

async function buildTvPlan(
  options: OrganizePlanOptions,
  files: OrganizeSourceFile[],
  roots: string[],
  settings: OrganizeSettings,
  catalog: PlexCatalog | undefined,
  client: TvdbClient,
  caseInsensitive: boolean,
  probe: (filePath: string) => Promise<ProbeDimensions>,
  onFileStart?: (
    completed: number,
    total: number,
    currentFile: string,
    currentShow?: string,
  ) => void,
  onPlanned?: (
    completed: number,
    total: number,
    currentFile: string,
    currentShow?: string,
  ) => void,
  onPlanning?: () => void,
): Promise<OrganizePlan> {
  const limit = options.matchConcurrency ?? defaultMatchConcurrency();
  const replacements = settings.nameReplacements ?? [];
  const warnings: string[] = [];
  const failureReasons = new Map<string, number>();
  const episodeCache = new Map<string, Promise<TvdbEpisode[]>>();
  const plannedSlots: (PlannedFileInput | undefined)[] = new Array(files.length);
  let plannedCount = 0;
  let notInLibrary = 0;
  const fileDone = (file: OrganizeSourceFile, show?: string) => {
    plannedCount += 1;
    onPlanned?.(plannedCount, files.length, file.path, show);
  };
  const home = options.home ?? '';

  interface PreparedTvFile {
    index: number;
    file: OrganizeSourceFile;
    parsedBase: ParsedMediaName;
    override: OrganizeMatchOverride | undefined;
    series: TvdbSeriesRef;
    showSubpath: string;
    showFolder?: string;
  }

  const prepared: PreparedTvFile[] = [];
  for (const [index, file] of files.entries()) {
    const folder = options.library.folders.find((candidate) => {
      const source = expandHomePath(candidate.source, home).trim();
      return isPathInside(file.path, path.resolve(source));
    });
    const parsedBase = parseMediaFilenameWithReplacements(
      file.filename,
      file.relativePath,
      replacements,
    );
    if (!folder) {
      notInLibrary += 1;
      plannedSlots[index] = {
        ...file,
        parsed: parsedBase,
        confidence: 0,
        reason: 'Source folder is not in this library',
      };
      fileDone(file);
      continue;
    }
    const folderRoot = path.resolve(expandHomePath(folder.source, home));
    const relativeToFolder = path.relative(folderRoot, file.path);
    const mapping = resolveShowMapping(settings, folder.id, relativeToFolder, {
      caseInsensitive,
    });
    const override = overrideFor(settings, file.path, caseInsensitive);
    const series = override?.series ?? mapping?.series;
    if (!series) {
      plannedSlots[index] = {
        ...file,
        parsed: parsedBase,
        confidence: 0,
        reason: 'No TVDB series selected',
      };
      fileDone(file);
      continue;
    }
    const showSubpath = mapping?.subpath ?? '';
    const showFolder = showSubpath
      ? showSubpath.split(/[\\/]+/).filter(Boolean).pop()
      : path.basename(folderRoot);
    prepared.push({
      index,
      file,
      parsedBase,
      override,
      series,
      showSubpath,
      ...(showFolder ? { showFolder } : {}),
    });
  }

  const episodesFor = (series: TvdbSeriesRef): Promise<TvdbEpisode[]> => {
    let pending = episodeCache.get(series.slug);
    if (!pending) {
      pending = client.loadEpisodes(series.slug).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        return [] as TvdbEpisode[];
      });
      episodeCache.set(series.slug, pending);
    }
    return pending;
  };

  const planned = await mapWithConcurrency(prepared, limit, async (input) => {
    const { file, parsedBase, override, series, showSubpath } = input;
    onFileStart?.(plannedCount, files.length, file.path, series.name);
    let parsed = parsedBase;
    try {
      parsed = withProbeResolution(parsed, await probe(file.path));
    } catch {
      // Keep the filename-derived resolution when the file cannot be probed.
    }
    const episodes = await episodesFor(series);
    const manualEpisodes = override?.episodes?.length
      ? sortEpisodes(override.episodes)
      : undefined;
    const manualEpisode = override?.episode ?? manualEpisodes?.[0];
    const resolution: EpisodeResolution = manualEpisode
      ? {
          episode: manualEpisode,
          confidence: 1,
          reason: 'Manual match',
          conflict: false,
        }
      : resolveEpisode(parsed, episodes, { seriesName: series.name });
    const rangeEpisodes =
      manualEpisodes ??
      episodesForRange(episodes, resolution.episode, parsed);
    const plexFiles = catalog
      ? findEpisodeAssociations(catalog.episodes, file.path, caseInsensitive)
      : [];
    const plexFile = plexFiles[0];
    fileDone(file, series.name);
    return {
      index: input.index,
      planned: {
        ...file,
        parsed: parsedWithProbe(parsed, plexFile ?? {}),
        confidence: resolution.confidence,
        reason: resolution.reason || 'No matching TVDB episode',
        seriesName: series.name,
        showSubpath,
        ...(series.year ? { seriesYear: series.year } : {}),
        ...(input.showFolder ? { showFolder: input.showFolder } : {}),
        ...(resolution.episode ? { episode: resolution.episode } : {}),
        ...(rangeEpisodes ? { episodes: rangeEpisodes } : {}),
        ...(resolution.summary ? { episodeMatch: resolution.summary } : {}),
        ...(plexFile ? { plex: associationFromEpisode(plexFile) } : {}),
        ...(plexFiles.length > 1
          ? { plexEpisodes: plexFiles.map(associationFromEpisode) }
          : {}),
      } satisfies PlannedFileInput,
    };
  });

  for (const entry of planned) {
    plannedSlots[entry.index] = entry.planned;
  }
  if (notInLibrary > 0) {
    warnings.push(
      `${notInLibrary} file(s) are not under a library source folder.`,
    );
  }
  for (const [reason, count] of failureReasons) {
    warnings.push(`${count} TVDB episode lookup(s) failed (${reason}).`);
  }

  onPlanning?.();
  const plan = buildOrganizePlan({
    mediaType: 'tv',
    sourceRoots: roots,
    files: plannedSlots.filter(
      (entry): entry is PlannedFileInput => Boolean(entry),
    ),
    rules: settings.namingRules,
    confidenceThreshold: settings.confidenceThreshold,
    renameMovieFolders: settings.renameMovieFolders,
    caseInsensitive,
    collisions: settings.collisions,
    sidecarPolicy: settings.sidecars,
    existingPaths: files.flatMap((file) => [
      file.path,
      ...(file.sidecars ?? []),
    ]),
  });
  plan.warnings.push(...warnings);
  return plan;
}

async function buildMoviePlan(
  options: OrganizePlanOptions,
  files: OrganizeSourceFile[],
  roots: string[],
  settings: OrganizeSettings,
  catalog: PlexCatalog | undefined,
  client: TvdbClient,
  caseInsensitive: boolean,
  probe: (filePath: string) => Promise<ProbeDimensions>,
  onFileStart?: (
    completed: number,
    total: number,
    currentFile: string,
    currentShow?: string,
  ) => void,
  onPlanned?: (
    completed: number,
    total: number,
    currentFile: string,
    currentShow?: string,
  ) => void,
  onPlanning?: () => void,
): Promise<OrganizePlan> {
  const limit = options.matchConcurrency ?? defaultMatchConcurrency();
  const replacements = settings.nameReplacements ?? [];
  const warnings: string[] = [];
  const failureReasons = new Map<string, number>();
  const moviesByQuery = new Map<string, TvdbMovie[]>();
  let plannedCount = 0;
  const fileDone = (file: OrganizeSourceFile) => {
    plannedCount += 1;
    onPlanned?.(plannedCount, files.length, file.path);
  };

  interface PreparedMovie {
    file: OrganizeSourceFile;
    parsed: ParsedMediaName;
    plexFile?: PlexMovieFile;
    override: OrganizeMatchOverride | undefined;
    query: string;
    needsSearch: boolean;
  }

  const prepared: PreparedMovie[] = files.map((file) => {
    const parsed = parseMediaFilenameWithReplacements(
      file.filename,
      file.relativePath,
      replacements,
    );
    const plexFile = catalog
      ? findMovieAssociation(catalog.movies, file.path, caseInsensitive)
      : undefined;
    const override = overrideFor(settings, file.path, caseInsensitive);
    const query = parsed.title || parsed.cleanTitle;
    return {
      file,
      parsed,
      ...(plexFile ? { plexFile } : {}),
      override,
      query,
      needsSearch:
        Boolean(query) &&
        !override?.movie &&
        !(settings.movieMetadata === 'plex' && plexFile),
    };
  });

  // Batch unique title searches through the TVDB client's multi-query endpoint.
  const queryByKey = new Map<string, string>();
  for (const entry of prepared) {
    if (!entry.needsSearch) continue;
    const key = entry.query.toLowerCase();
    if (!queryByKey.has(key)) queryByKey.set(key, entry.query);
  }
  if (queryByKey.size > 0) {
    const entries = [...queryByKey.entries()];
    try {
      const searched = await client.searchMany(
        entries.map(([, query]) => query),
      );
      for (const [index, [key]] of entries.entries()) {
        moviesByQuery.set(key, searched[index]?.movies ?? []);
      }
    } catch {
      await mapWithConcurrency(entries, limit, async ([key, query]) => {
        try {
          moviesByQuery.set(key, await client.searchMovies(query));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
          moviesByQuery.set(key, []);
        }
      });
    }
  }

  const planned = await mapWithConcurrency(prepared, limit, async (input) => {
    const { file, override } = input;
    onFileStart?.(plannedCount, files.length, file.path);
    let parsed = input.parsed;
    try {
      parsed = withProbeResolution(parsed, await probe(file.path));
    } catch {
      // Resolution is optional for matching; the template simply renders empty.
    }
    if (override?.movie) {
      fileDone(file);
      return {
        ...file,
        parsed: parsedWithProbe(parsed, input.plexFile ?? {}),
        confidence: 1,
        reason: 'Manual match',
        movie: override.movie,
        ...(input.plexFile
          ? { plex: associationFromMovie(input.plexFile) }
          : {}),
      } satisfies PlannedFileInput;
    }
    if (settings.movieMetadata === 'plex' && input.plexFile) {
      fileDone(file);
      return {
        ...file,
        parsed: parsedWithProbe(parsed, input.plexFile),
        confidence: 1,
        reason: 'Plex metadata',
        movie: {
          id: String(input.plexFile.metadataItemId),
          slug: '',
          title: input.plexFile.title,
          ...(input.plexFile.year ? { year: input.plexFile.year } : {}),
        },
        plex: associationFromMovie(input.plexFile),
      } satisfies PlannedFileInput;
    }

    const movies = moviesByQuery.get(input.query.toLowerCase()) ?? [];
    const best = rankMovies(parsed, movies, 1)[0];
    fileDone(file);
    return {
      ...file,
      parsed: parsedWithProbe(parsed, input.plexFile ?? {}),
      confidence: best?.confidence ?? 0,
      reason: best?.reason ?? 'No matching TVDB movie',
      ...(best?.movie ? { movie: best.movie } : {}),
      ...(input.plexFile
        ? { plex: associationFromMovie(input.plexFile) }
        : {}),
    } satisfies PlannedFileInput;
  });

  for (const [reason, count] of failureReasons) {
    warnings.push(`${count} TVDB movie lookup(s) failed (${reason}).`);
  }

  onPlanning?.();
  const plan = buildOrganizePlan({
    mediaType: 'movies',
    sourceRoots: roots,
    files: planned,
    rules: settings.namingRules,
    confidenceThreshold: settings.confidenceThreshold,
    renameMovieFolders: settings.renameMovieFolders,
    caseInsensitive,
    collisions: settings.collisions,
    sidecarPolicy: settings.sidecars,
    existingPaths: files.flatMap((file) => [
      file.path,
      ...(file.sidecars ?? []),
    ]),
  });
  plan.warnings.push(...warnings);
  return plan;
}

/** Scans the selected library folders and returns a reviewable plan. */
export async function buildOrganizePlanForLibrary(
  options: OrganizePlanOptions,
): Promise<OrganizePlan> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const settings = resolveOrganizeSettings(
    options.settings ?? options.library.organize,
    options.library.mediaType,
  );
  const dbPath = options.plexDbPath
    ? path.resolve(expandHomePath(options.plexDbPath, home))
    : undefined;
  let catalog = options.catalog;
  let catalogWarning: string | undefined;
  if (!catalog && dbPath && fs.existsSync(dbPath)) {
    const loaded = loadPlexCatalog(dbPath, options.appPaths.cacheDir);
    catalog = loaded.catalog;
    if (!catalog) {
      catalogWarning = `Plex metadata was unavailable (${
        loaded.error?.message ?? 'unknown error'
      }); matching continued with file names and TVDB.`;
    }
  }
  const client =
    options.tvdbClient ??
    new TvdbClient({
      cacheDir: options.appPaths.cacheDir,
    });
  const cachedScan = options.reuseScanId
    ? scanCaches.get(options.reuseScanId)
    : undefined;
  const isPartialRescan = Boolean(options.rescanFolders?.length);
  const rescanScope = isPartialRescan
    ? scopeForRescanFolders(options.library, options.rescanFolders ?? [], home)
    : undefined;
  const scope = isPartialRescan ? rescanScope : options.scope;
  const reuse =
    cachedScan &&
    !isPartialRescan &&
    cachedScan.libraryId === options.library.id &&
    cachedScan.mediaType === options.library.mediaType &&
    cachedScan.scopeKey === scopeKey(scope)
      ? cachedScan
      : undefined;
  const probeCache = reuse?.probeCache ?? new Map<string, ProbeDimensions>();
  const baseProbe =
    options.probeMedia ??
    (async (filePath: string) => {
      const info = await defaultProbeMedia(filePath);
      const video = info.streams.find((stream) => stream.type === 'video');
      return { width: video?.width, height: video?.height };
    });
  const probe = async (filePath: string): Promise<ProbeDimensions> => {
    const key = organizerComparisonKey(filePath, {
      caseInsensitive: isCaseInsensitivePlatform(platform),
    });
    const cached = probeCache.get(key);
    if (cached) return cached;
    const dimensions = await baseProbe(filePath);
    probeCache.set(key, dimensions);
    return dimensions;
  };

  const startedAt = Date.now();
  let lastSentAt = 0;
  const report = (update: {
    phase: OrganizeScanProgress['phase'];
    completed: number;
    total: number;
    discovered: number;
    currentFile?: string;
    currentShow?: string;
    etaMs?: number;
    force?: boolean;
  }) => {
    if (!options.onProgress) return;
    const now = Date.now();
    if (!update.force && now - lastSentAt < 100) return;
    lastSentAt = now;
    const { force: _force, ...rest } = update;
    options.onProgress({ ...rest, elapsedMs: now - startedAt });
  };

  let files: OrganizeSourceFile[];
  let roots: string[];
  let scanWarnings: string[];
  let scanCache: OrganizeScanCache;
  if (reuse) {
    files = reuse.files;
    roots = reuse.roots;
    scanWarnings = reuse.warnings;
    scanCache = reuse;
    report({
      phase: 'matching',
      completed: 0,
      total: files.length,
      discovered: files.length,
      force: true,
    });
  } else {
    const discovered =
      isPartialRescan && !scope
        ? {
            files: [] as OrganizeSourceFile[],
            roots: [] as string[],
            warnings: [
              'None of the selected folders are part of this library.',
            ],
          }
        : await scanLibraryFiles(
            options.library,
            home,
            (discoveredCount, currentFile) =>
              report({
                phase: 'discovering',
                completed: 0,
                total: 0,
                discovered: discoveredCount,
                currentFile,
              }),
            scope,
          );
    files = discovered.files;
    roots = discovered.roots;
    scanWarnings = discovered.warnings;
    report({
      phase: 'discovering',
      completed: 0,
      total: 0,
      discovered: files.length,
      force: true,
    });
    report({
      phase: 'matching',
      completed: 0,
      total: files.length,
      discovered: files.length,
      force: true,
    });
    scanCache = {
      id: randomUUID(),
      libraryId: options.library.id,
      mediaType: options.library.mediaType,
      scopeKey: scopeKey(scope),
      files,
      roots,
      warnings: scanWarnings,
      probeCache,
      createdAt: Date.now(),
    };
    rememberScanCache(scanCache);
  }

  const onFileStart = (
    completed: number,
    total: number,
    currentFile: string,
    currentShow?: string,
  ) => {
    const elapsedMs = Date.now() - startedAt;
    const etaMs =
      completed > 0
        ? Math.round((elapsedMs / completed) * (total - completed))
        : undefined;
    report({
      phase: 'matching',
      completed,
      total,
      discovered: files.length,
      currentFile,
      ...(currentShow ? { currentShow } : {}),
      ...(etaMs !== undefined ? { etaMs } : {}),
      // Make the very first in-flight file visible immediately.
      ...(completed === 0 ? { force: true } : {}),
    });
  };
  const onPlanned = (
    completed: number,
    total: number,
    currentFile: string,
    currentShow?: string,
  ) => {
    const elapsedMs = Date.now() - startedAt;
    const etaMs =
      completed > 0
        ? Math.round((elapsedMs / completed) * (total - completed))
        : undefined;
    report({
      phase: 'matching',
      completed,
      total,
      discovered: files.length,
      currentFile,
      ...(currentShow ? { currentShow } : {}),
      ...(etaMs !== undefined ? { etaMs } : {}),
      ...(completed >= total ? { force: true } : {}),
    });
  };
  const onPlanning = () =>
    report({
      phase: 'planning',
      completed: files.length,
      total: files.length,
      discovered: files.length,
      force: true,
    });

  const caseInsensitive =
    settings.caseInsensitive ?? isCaseInsensitivePlatform(platform);
  const plan =
    options.library.mediaType === 'tv'
      ? await buildTvPlan(
          options,
          files,
          roots,
          settings,
          catalog,
          client,
          caseInsensitive,
          probe,
          onFileStart,
          onPlanned,
          onPlanning,
        )
      : await buildMoviePlan(
          options,
          files,
          roots,
          settings,
          catalog,
          client,
          caseInsensitive,
          probe,
          onFileStart,
          onPlanned,
          onPlanning,
        );
  plan.warnings.unshift(
    ...(catalogWarning ? [catalogWarning] : []),
    ...scanWarnings,
  );
  plan.libraryId = options.library.id;
  plan.scanId = scanCache.id;
  return plan;
}

async function reverseMoves(moves: OrganizeJournalMove[]): Promise<void> {
  for (const moveEntry of [...moves].reverse()) {
    for (const sidecar of [...moveEntry.sidecars].reverse()) {
      try {
        if (fs.existsSync(sidecar.targetPath)) {
          await move(sidecar.targetPath, sidecar.sourcePath, { overwrite: false });
        }
      } catch {
        // Best-effort recovery; the journal still records the original move.
      }
    }
    try {
      if (fs.existsSync(moveEntry.targetPath)) {
        await move(moveEntry.targetPath, moveEntry.sourcePath, { overwrite: false });
      }
    } catch {
      // Best-effort recovery.
    }
  }
}

async function removeEmptyParents(
  directory: string,
  root: string,
): Promise<void> {
  let current = directory;
  const stop = path.resolve(root);
  while (isPathInside(current, stop) && path.resolve(current) !== stop) {
    try {
      const entries = await fs.promises.readdir(current);
      if (entries.length > 0) return;
      await fs.promises.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** Applies a plan, journaling file moves before touching Plex. */
export async function applyOrganizePlan(
  options: OrganizeApplyOptions,
): Promise<OrganizeApplyResult> {
  const platform = options.platform ?? process.platform;
  if (options.plan.items.some((item) => item.action === 'conflict')) {
    throw new Error('Resolve the target path conflicts before applying.');
  }
  const actionable = options.plan.items.filter(
    (item) => item.action === 'rename',
  );
  const journal: OrganizeJournal = {
    planId: options.plan.createdAt,
    createdAt: new Date().toISOString(),
    status: 'in-progress',
    mediaType: options.plan.mediaType,
    moves: [],
  };
  const result: OrganizeApplyResult = {
    planId: journal.planId,
    renamed: [],
    skipped: options.plan.items
      .filter((item) => item.action === 'skip')
      .map((item) => item.sourcePath),
    failed: [],
    plexUpdated: 0,
    historyMoved: 0,
    pendingHistoryTransfers: 0,
    warnings: [...options.plan.warnings],
  };

  if (options.updatePlex) {
    const dbPath = options.plexDbPath;
    if (!dbPath) {
      throw new Error(
        'Choose a Plex database in Settings before enabling the Plex update.',
      );
    }
    const resolvedDb = path.resolve(
      expandHomePath(
        dbPath,
        process.env.HOME ?? process.env.USERPROFILE ?? '',
      ),
    );
    const exists = fs.existsSync(resolvedDb);
    const user = plexUser();
    const status = await detectPlexService(platform);
    if (status.running) {
      const remediation = plexRemediation({
        platform,
        dbPath: resolvedDb,
        user,
        exists,
        writable: true,
        running: true,
        serviceKind: status.kind,
      });
      throw new Error(
        `Plex Media Server is running.\n\n${remediation.script}`,
      );
    }
    const access = plexAccessState(platform, resolvedDb);
    if (!access.writable) {
      const remediation = plexRemediation({
        platform,
        dbPath: resolvedDb,
        user,
        exists,
        writable: access.writable,
        folderWritable: access.folderWritable,
        running: false,
        serviceKind: status.kind,
      });
      throw new Error(
        `HBBatchBeast cannot write the Plex database.\n\n${remediation.script}`,
      );
    }
    const stillRunning = await detectPlexService(platform);
    if (stillRunning.running) {
      const remediation = plexRemediation({
        platform,
        dbPath: resolvedDb,
        user,
        exists,
        writable: true,
        running: true,
        serviceKind: stillRunning.kind,
      });
      throw new Error(
        `Plex Media Server started again.\n\n${remediation.script}`,
      );
    }
  }

  writeJournal(options.appPaths, journal);
  for (const item of actionable) {
    try {
      await fs.promises.mkdir(path.dirname(item.targetPath), { recursive: true });
      if (item.caseOnly) {
        const temp = `${item.targetPath}.hbb-case-${Date.now()}`;
        await move(item.sourcePath, temp, { overwrite: false });
        await move(temp, item.targetPath, { overwrite: false });
      } else {
        await move(item.sourcePath, item.targetPath, { overwrite: false });
      }
      const sidecars: OrganizeJournalMove['sidecars'] = [];
      for (const sidecar of item.sidecars) {
        await fs.promises.mkdir(path.dirname(sidecar.targetPath), {
          recursive: true,
        });
        await move(sidecar.sourcePath, sidecar.targetPath, {
          overwrite: false,
        });
        sidecars.push(sidecar);
      }
      journal.moves.push({
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        sidecars,
      });
      writeJournal(options.appPaths, journal);
      result.renamed.push(item.targetPath);
      if (options.settings.cleanupEmptyFolders) {
        const root =
          options.plan.sourceRoots.find((candidate) =>
            isPathInside(item.sourcePath, candidate),
          ) ?? path.dirname(item.sourcePath);
        await removeEmptyParents(path.dirname(item.sourcePath), root);
      }
    } catch (error) {
      result.failed.push({
        path: item.sourcePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeJournal(options.appPaths, journal);
  if (options.updatePlex && result.failed.length === 0) {
    try {
      const plex = updatePlexFromPlan(options.plan, {
        dbPath: path.resolve(
          expandHomePath(
            options.plexDbPath ?? '',
            process.env.HOME ?? process.env.USERPROFILE ?? '',
          ),
        ),
        backupDir: options.appPaths.backupDir,
        pendingPath: pendingPath(options.appPaths),
        platform,
        caseInsensitive:
          options.settings.caseInsensitive ??
          isCaseInsensitivePlatform(platform),
      });
      journal.plex = plex;
      journal.status = 'applied';
      result.plexUpdated = plex.updated;
      result.historyMoved = plex.historyMoved;
      result.pendingHistoryTransfers = plex.pendingTransfers;
      result.warnings.push(...plex.warnings);
    } catch (error) {
      journal.status = 'failed';
      journal.warning = error instanceof Error ? error.message : String(error);
      writeJournal(options.appPaths, journal);
      await reverseMoves(journal.moves);
      throw error;
    }
  } else {
    journal.status = result.failed.length > 0 ? 'failed' : 'applied';
    if (result.failed.length > 0) {
      journal.warning = 'Some file moves failed; Plex was not updated.';
    }
  }
  writeJournal(options.appPaths, journal);
  return result;
}

/** Reverses the last apply, optionally restoring the pre-apply Plex backup. */
export async function undoLastOrganize(
  appPaths: AppPaths,
  options: { restorePlex?: boolean } = {},
): Promise<{ reversed: number; warnings: string[] }> {
  const journal = readOrganizeJournal(appPaths);
  if (!journal) throw new Error('There is no organize journal to undo.');
  const warnings: string[] = [];
  await reverseMoves(journal.moves);
  if (options.restorePlex && journal.plex?.backupPath) {
    const dbPath = journal.plex.backupPath;
    warnings.push(
      `Plex database backup is at ${dbPath}. Restore it only while Plex is stopped.`,
    );
  }
  journal.status = 'failed';
  journal.warning = 'Undone from the organize journal';
  writeJournal(appPaths, journal);
  return { reversed: journal.moves.length, warnings };
}

export { completePendingHistoryTransfers };
