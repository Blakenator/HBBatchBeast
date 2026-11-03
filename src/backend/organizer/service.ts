import fs from 'fs';
import path from 'path';
import { move } from 'fs-extra';
import type { AppPaths } from '../helpers/appPaths';
import { probeMedia as defaultProbeMedia } from '../helpers/probeMedia';
import type { Library } from '../../common/library';
import type {
  OrganizeApplyResult,
  OrganizePlan,
  OrganizeSourceFile,
  ParsedMediaName,
  OrganizeScanProgress,
  OrganizeScanScope,
  PlexAssociation,
  TvdbEpisode,
  TvdbMovie,
} from '../../common/organizer/types';
import type { OrganizeSettings } from '../../common/organizer/settings';
import {
  buildOrganizePlan,
  isCaseInsensitivePlatform,
  organizerComparisonKey,
  findShowMapping,
  overrideFor,
  parseMediaFilename,
  pickBestSeries,
  guessSeriesQuery,
  normalizeSubpath,
  rankEpisodes,
  rankMovies,
  resolveOrganizeSettings,
  resolveShowMapping,
  type DetectedShow,
} from '../../common/organizer';
import { expandHomePath, isPathInside } from '../../common/pathUtils';
import { SIDECAR_EXTENSIONS, isMediaExtension } from '../../common/organizer/filename';
import { TvdbClient } from './tvdb/client';
import {
  readPlexCatalog,
  type PlexCatalog,
  type PlexEpisodeFile,
  type PlexMovieFile,
} from './plex/catalog';
import {
  plexPermissionRemediation,
  plexServiceInstructions,
} from './plex/environment';
import { detectPlexService } from './plex/service';
import {
  completePendingHistoryTransfers,
  updatePlexFromPlan,
  type PlexUpdateResult,
} from './plex/writer';

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
  probeMedia?: (filePath: string) => Promise<{ height?: number }>;
  /** Global Plex database path, independent of the library. */
  plexDbPath?: string;
  /** Receives throttled live progress while the plan is built. */
  onProgress?: (progress: OrganizeScanProgress) => void;
  /** Restricts the scan to the selected show folders. */
  scope?: OrganizeScanScope[];
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

function findEpisodeAssociation(
  files: PlexEpisodeFile[],
  filePath: string,
  caseInsensitive: boolean,
): PlexEpisodeFile | undefined {
  return files.find(
    (file) =>
      organizerComparisonKey(file.file, { caseInsensitive }) ===
      organizerComparisonKey(filePath, { caseInsensitive }),
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

async function scanLibraryFiles(
  library: Library,
  home: string,
  onDiscovered?: (discovered: number, currentFile: string) => void,
  scope?: OrganizeScanScope[],
): Promise<{ files: OrganizeSourceFile[]; warnings: string[]; roots: string[] }> {
  const files: OrganizeSourceFile[] = [];
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
  const folders: DetectedShow[] = [];
  const warnings: string[] = [];

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
      folders.push({
        folderId: folder.id,
        root,
        subpath: '',
        name: path.basename(root),
        mediaCount: await countMediaFiles(root, true),
        series: rootMapping.series,
        query: guessSeriesQuery(path.basename(root)).query,
      });
      continue;
    }

    const shows: { subpath: string; name: string; mediaCount: number }[] = [];
    const direct = await countMediaFiles(root, false);
    if (direct > 0) {
      shows.push({ subpath: '', name: path.basename(root), mediaCount: direct });
    } else {
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.promises.readdir(root, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
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
      const guess = guessSeriesQuery(show.name);
      const existing = findShowMapping(settings, folder.id, show.subpath);
      if (existing) {
        folders.push({
          folderId: folder.id,
          root,
          ...show,
          series: existing.series,
          query: guess.query,
        });
        continue;
      }
      try {
        const candidates = await options.tvdbClient.searchSeries(guess.query);
        const match = pickBestSeries(candidates, guess);
        folders.push({
          folderId: folder.id,
          root,
          ...show,
          query: guess.query,
          candidates: candidates.slice(0, 8),
          ...(match ? { series: match.series, autoMatched: true } : {}),
        });
      } catch (error) {
        warnings.push(
          `${show.name}: TVDB search failed (${error instanceof Error ? error.message : String(error)}).`,
        );
        folders.push({ folderId: folder.id, root, ...show, query: guess.query });
      }
    }
  }

  return { folders, warnings };
}

function parsedWithProbe(
  parsed: ParsedMediaName,
  height: number | undefined,
): ParsedMediaName {
  if (parsed.resolution || !height) return parsed;
  return withProbeResolution(parsed, height);
}

/** ffprobe is authoritative; the filename is only a fallback. */
function withProbeResolution(
  parsed: ParsedMediaName,
  height: number | undefined,
): ParsedMediaName {
  if (!height) return parsed;
  return {
    ...parsed,
    resolution:
      height > 2000
        ? '4K'
        : height > 1400
          ? '1440p'
          : height > 1000
            ? '1080p'
            : height > 700
              ? '720p'
              : height > 500
                ? '480p'
                : 'SD',
    height,
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
  probe: (filePath: string) => Promise<{ height?: number }>,
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
  const planned = [];
  const warnings: string[] = [];
  const episodeCache = new Map<string, TvdbEpisode[]>();
  let plannedCount = 0;
  const fileDone = (file: OrganizeSourceFile, show?: string) => {
    plannedCount += 1;
    onPlanned?.(plannedCount, files.length, file.path, show);
  };
  const home = options.home ?? '';
  for (const file of files) {
    const folder = options.library.folders.find((candidate) => {
      const source = expandHomePath(candidate.source, home).trim();
      return isPathInside(file.path, path.resolve(source));
    });
    const parsedBase = parseMediaFilename(file.filename, file.relativePath);
    if (!folder) {
      warnings.push(`${file.path}: its source folder is not in this library.`);
      planned.push({
        ...file,
        parsed: parsedBase,
        confidence: 0,
        reason: 'Source folder is not in this library',
      });
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
      warnings.push(
        `${file.path}: match a TVDB series to its show folder before scanning.`,
      );
      planned.push({
        ...file,
        parsed: parsedBase,
        confidence: 0,
        reason: 'No TVDB series selected',
      });
      fileDone(file);
      continue;
    }
    onFileStart?.(plannedCount, files.length, file.path, series.name);
    let parsed = parsedBase;
    try {
      parsed = withProbeResolution(parsed, (await probe(file.path)).height);
    } catch {
      // Keep the filename-derived resolution when the file cannot be probed.
    }
    let episodes = episodeCache.get(series.slug);
    if (!episodes) {
      try {
        episodes = await client.loadEpisodes(series.slug);
      } catch (error) {
        warnings.push(
          `${file.path}: TVDB lookup failed (${error instanceof Error ? error.message : String(error)}).`,
        );
        episodes = [];
      }
      episodeCache.set(series.slug, episodes);
    }
    const best = override?.episode
      ? { episode: override.episode, confidence: 1, reason: 'Manual match' }
      : rankEpisodes(parsed, episodes, 1)[0];
    const plexFile = catalog
      ? findEpisodeAssociation(catalog.episodes, file.path, caseInsensitive)
      : undefined;
    const showSubpath = mapping?.subpath ?? '';
    const showFolder = showSubpath
      ? showSubpath.split(/[\\/]+/).filter(Boolean).pop()
      : path.basename(folderRoot);
    planned.push({
      ...file,
      parsed,
      confidence: best?.confidence ?? 0,
      reason: best?.reason ?? 'No matching TVDB episode',
      seriesName: series.name,
      showSubpath,
      ...(series.year ? { seriesYear: series.year } : {}),
      ...(showFolder ? { showFolder } : {}),
      ...(best?.episode ? { episode: best.episode } : {}),
      ...(plexFile ? { plex: associationFromEpisode(plexFile) } : {}),
    });
    fileDone(file, series.name);
  }
  onPlanning?.();
  const plan = buildOrganizePlan({
    mediaType: 'tv',
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

async function buildMoviePlan(
  options: OrganizePlanOptions,
  files: OrganizeSourceFile[],
  roots: string[],
  settings: OrganizeSettings,
  catalog: PlexCatalog | undefined,
  client: TvdbClient,
  caseInsensitive: boolean,
  probe: (filePath: string) => Promise<{ height?: number }>,
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
  const planned = [];
  const warnings: string[] = [];
  const searchCache = new Map<string, TvdbMovie[]>();
  let plannedCount = 0;
  const fileDone = (file: OrganizeSourceFile) => {
    plannedCount += 1;
    onPlanned?.(plannedCount, files.length, file.path);
  };
  for (const file of files) {
    onFileStart?.(plannedCount, files.length, file.path);
    let parsed = parseMediaFilename(file.filename, file.relativePath);
    const plexFile = catalog
      ? findMovieAssociation(catalog.movies, file.path, caseInsensitive)
      : undefined;
    const override = overrideFor(settings, file.path, caseInsensitive);
    try {
      parsed = withProbeResolution(parsed, (await probe(file.path)).height);
    } catch {
      // Resolution is optional for matching; the template simply renders empty.
    }
    if (override?.movie) {
      planned.push({
        ...file,
        parsed,
        confidence: 1,
        reason: 'Manual match',
        movie: override.movie,
        ...(plexFile ? { plex: associationFromMovie(plexFile) } : {}),
      });
      fileDone(file);
      continue;
    }
    if (settings.movieMetadata === 'plex' && plexFile) {
      planned.push({
        ...file,
        parsed: parsedWithProbe(parsed, plexFile.height),
        confidence: 1,
        reason: 'Plex metadata',
        movie: {
          id: String(plexFile.metadataItemId),
          slug: '',
          title: plexFile.title,
          ...(plexFile.year ? { year: plexFile.year } : {}),
        },
        plex: associationFromMovie(plexFile),
      });
      fileDone(file);
      continue;
    }

    const query = parsed.title || parsed.cleanTitle;
    let movies = searchCache.get(query.toLowerCase());
    if (!movies) {
      try {
        movies = await client.searchMovies(query);
        searchCache.set(query.toLowerCase(), movies);
      } catch (error) {
        warnings.push(
          `${file.path}: TVDB movie lookup failed (${error instanceof Error ? error.message : String(error)}).`,
        );
        movies = [];
      }
    }
    const best = rankMovies(parsed, movies, 1)[0];
    planned.push({
      ...file,
      parsed,
      confidence: best?.confidence ?? 0,
      reason: best?.reason ?? 'No matching TVDB movie',
      ...(best?.movie ? { movie: best.movie } : {}),
      ...(plexFile ? { plex: associationFromMovie(plexFile) } : {}),
    });
    fileDone(file);
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
  const catalog =
    options.catalog ??
    (dbPath && fs.existsSync(dbPath) ? readPlexCatalog(dbPath) : undefined);
  const client =
    options.tvdbClient ??
    new TvdbClient({
      cacheDir: options.appPaths.cacheDir,
    });
  const probe =
    options.probeMedia ??
    (async (filePath: string) => {
      const info = await defaultProbeMedia(filePath);
      const video = info.streams.find((stream) => stream.type === 'video');
      return { height: video?.height };
    });

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

  const { files, warnings, roots } = await scanLibraryFiles(
    options.library,
    home,
    (discovered, currentFile) =>
      report({
        phase: 'discovering',
        completed: 0,
        total: 0,
        discovered,
        currentFile,
      }),
    options.scope,
  );
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
  plan.warnings.unshift(...warnings);
  plan.libraryId = options.library.id;
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
    const status = await detectPlexService(platform);
    if (status.running) {
      throw new Error(
        `Plex Media Server is running. ${plexServiceInstructions(platform)}`,
      );
    }
    const resolvedDb = path.resolve(
      expandHomePath(
        dbPath,
        process.env.HOME ?? process.env.USERPROFILE ?? '',
      ),
    );
    try {
      fs.accessSync(resolvedDb, fs.constants.W_OK);
    } catch {
      throw new Error(
        `HBBatchBeast cannot write the Plex database. ${plexPermissionRemediation(platform, resolvedDb)}`,
      );
    }
    const stillRunning = await detectPlexService(platform);
    if (stillRunning.running) {
      throw new Error(
        `Plex Media Server started again. ${plexServiceInstructions(platform)}`,
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
