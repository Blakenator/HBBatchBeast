import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PlexWatchState } from '../../../common/organizer/types';

export interface PlexLibraryRoot {
  sectionId: number;
  name: string;
  sectionType: number;
  rootPath: string;
}

export interface PlexDirectory {
  id: number;
  librarySectionId: number;
  parentDirectoryId?: number;
  path: string;
}

export interface PlexExternalStream {
  id: number;
  mediaItemId: number;
  mediaPartId?: number;
  url: string;
}

interface PlexFileBase {
  metadataItemId: number;
  guid: string;
  title: string;
  year?: number;
  width?: number;
  height?: number;
  airDate?: string;
  addedAt?: string;
  mediaItemId: number;
  mediaPartId: number;
  file: string;
  directoryId?: number;
  directoryPath?: string;
  librarySectionId: number;
  libraryRoot: string;
  watchCount: number;
  watchStates: PlexWatchState[];
}

export type PlexMovieFile = PlexFileBase;

export interface PlexEpisodeFile extends PlexFileBase {
  showId: number;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
}

export interface PlexCatalog {
  movies: PlexMovieFile[];
  episodes: PlexEpisodeFile[];
  directories: PlexDirectory[];
  externalStreams: PlexExternalStream[];
  libraryRoots: PlexLibraryRoot[];
}

interface WatchRow {
  account_id: number;
  guid: string;
  view_count: number;
  view_offset: number | null;
  last_viewed_at: string | null;
}

interface MovieRow {
  metadataItemId: number;
  guid: string;
  title: string;
  year: number | null;
  width: number | null;
  height: number | null;
  /** Plex stores this as epoch seconds, not a date string. */
  airDate: string | number | null;
  addedAt: string | null;
  mediaItemId: number;
  mediaPartId: number;
  file: string;
  directoryId: number | null;
  directoryPath: string | null;
  librarySectionId: number;
  libraryRoot: string;
}

interface EpisodeRow extends MovieRow {
  showId: number;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
}

function watchStatesByGuid(db: DatabaseSync): Map<string, PlexWatchState[]> {
  const rows = db
    .prepare(
      `SELECT account_id, guid, view_count, view_offset, last_viewed_at
       FROM metadata_item_settings`,
    )
    .all() as unknown as WatchRow[];
  const byGuid = new Map<string, PlexWatchState[]>();
  for (const row of rows) {
    if (!row.guid) continue;
    const state: PlexWatchState = {
      accountId: Number(row.account_id ?? 0),
      guid: row.guid,
      viewCount: Number(row.view_count ?? 0),
      ...(row.view_offset !== null && row.view_offset !== undefined
        ? { viewOffset: Number(row.view_offset) }
        : {}),
      ...(row.last_viewed_at ? { lastViewedAt: row.last_viewed_at } : {}),
    };
    const existing = byGuid.get(row.guid) ?? [];
    existing.push(state);
    byGuid.set(row.guid, existing);
  }
  return byGuid;
}

const MOVIE_SQL = `
  SELECT mti.id AS metadataItemId,
         mti.guid AS guid,
         mti.title AS title,
         mti.year AS year,
         mit.width AS width,
         mit.height AS height,
         mti.originally_available_at AS airDate,
         mti.added_at AS addedAt,
         mit.id AS mediaItemId,
         mp.id AS mediaPartId,
         mp.file AS file,
         mp.directory_id AS directoryId,
         d.path AS directoryPath,
         ls.id AS librarySectionId,
         sl.root_path AS libraryRoot
  FROM metadata_items mti
  JOIN media_items mit ON mit.metadata_item_id = mti.id
  JOIN media_parts mp ON mp.media_item_id = mit.id
  LEFT JOIN directories d ON d.id = mp.directory_id
  JOIN library_sections ls ON ls.id = mti.library_section_id AND ls.section_type = 1
  JOIN section_locations sl ON sl.library_section_id = ls.id
  WHERE mti.metadata_type = 1 AND mp.deleted_at IS NULL
  ORDER BY mti.title, mp.id
`;

const EPISODE_SQL = `
  SELECT show.id AS showId,
         show.title AS showTitle,
         season."index" AS seasonNumber,
         ep.id AS metadataItemId,
         ep.guid AS guid,
         ep.title AS title,
         ep."index" AS episodeNumber,
         ep.title AS episodeTitle,
         ep.year AS year,
         mit.width AS width,
         mit.height AS height,
         ep.originally_available_at AS airDate,
         ep.added_at AS addedAt,
         mit.id AS mediaItemId,
         mp.id AS mediaPartId,
         mp.file AS file,
         mp.directory_id AS directoryId,
         d.path AS directoryPath,
         ls.id AS librarySectionId,
         sl.root_path AS libraryRoot
  FROM metadata_items show
  JOIN metadata_items season ON season.parent_id = show.id AND season.metadata_type = 3
  JOIN metadata_items ep ON ep.parent_id = season.id AND ep.metadata_type = 4
  JOIN media_items mit ON mit.metadata_item_id = ep.id
  JOIN media_parts mp ON mp.media_item_id = mit.id
  LEFT JOIN directories d ON d.id = mp.directory_id
  JOIN library_sections ls ON ls.id = show.library_section_id AND ls.section_type = 2
  JOIN section_locations sl ON sl.library_section_id = ls.id
  WHERE show.metadata_type = 2 AND mp.deleted_at IS NULL
  ORDER BY show.title, season."index", ep."index", mp.id
`;

/** Plex stores `originally_available_at` as epoch seconds in UTC. */
function plexDateOnly(value: string | number): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const iso = /^\d{4}-\d{2}-\d{2}/.exec(trimmed);
    if (iso) return iso[0];
    if (!/^\d+$/.test(trimmed)) return '';
    value = Number(trimmed);
  }
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function baseFromRow(
  row: MovieRow,
  watches: PlexWatchState[],
): PlexFileBase {
  return {
    metadataItemId: Number(row.metadataItemId),
    guid: row.guid,
    title: row.title,
    ...(row.year !== null && row.year !== undefined
      ? { year: Number(row.year) }
      : {}),
    ...(row.width !== null && row.width !== undefined
      ? { width: Number(row.width) }
      : {}),
    ...(row.height !== null && row.height !== undefined
      ? { height: Number(row.height) }
      : {}),
    ...(row.airDate && plexDateOnly(row.airDate)
      ? { airDate: plexDateOnly(row.airDate) }
      : {}),
    ...(row.addedAt ? { addedAt: row.addedAt } : {}),
    mediaItemId: Number(row.mediaItemId),
    mediaPartId: Number(row.mediaPartId),
    file: row.file,
    ...(row.directoryId !== null && row.directoryId !== undefined
      ? { directoryId: Number(row.directoryId) }
      : {}),
    ...(row.directoryPath ? { directoryPath: row.directoryPath } : {}),
    librarySectionId: Number(row.librarySectionId),
    libraryRoot: row.libraryRoot,
    watchCount: watches.reduce((sum, state) => sum + state.viewCount, 0),
    watchStates: watches,
  };
}

const REQUIRED_SCHEMA: Record<string, string[]> = {
  library_sections: ['id', 'name', 'section_type'],
  section_locations: ['library_section_id', 'root_path'],
  directories: [
    'id',
    'library_section_id',
    'parent_directory_id',
    'path',
    'deleted_at',
    'created_at',
    'updated_at',
  ],
  metadata_items: [
    'id',
    'guid',
    'title',
    'year',
    'metadata_type',
    'parent_id',
    'index',
    'added_at',
    'library_section_id',
  ],
  media_items: ['id', 'metadata_item_id'],
  media_parts: [
    'id',
    'media_item_id',
    'file',
    'directory_id',
    'deleted_at',
    'updated_at',
  ],
  media_streams: [
    'id',
    'media_item_id',
    'media_part_id',
    'stream_type_id',
    'url',
    'updated_at',
  ],
  metadata_item_settings: [
    'id',
    'account_id',
    'guid',
    'view_count',
    'view_offset',
    'last_viewed_at',
    'skip_count',
    'last_skipped_at',
    'rating',
    'last_rated_at',
    'created_at',
  ],
  metadata_item_views: ['guid'],
};

interface TableInfoRow {
  name: string;
}

/**
 * Plex changes its schema between releases. Fail with an actionable message
 * instead of a raw `no such column` error from the first query.
 */
function assertPlexSchema(db: DatabaseSync): void {
  for (const [table, required] of Object.entries(REQUIRED_SCHEMA)) {
    const columns = db
      .prepare(`PRAGMA table_info("${table}")`)
      .all() as unknown as TableInfoRow[];
    if (columns.length === 0) {
      throw new Error(
        `Unsupported Plex database: table "${table}" is missing. Choose a Plex Media Server database that has been scanned at least once.`,
      );
    }
    const present = new Set(columns.map((column) => column.name));
    const missing = required.find((column) => !present.has(column));
    if (missing) {
      throw new Error(
        `Unsupported Plex database schema: ${table}.${missing} is missing. Let Plex update this database, then try again.`,
      );
    }
  }
}

export function readPlexCatalog(dbPath: string): PlexCatalog {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assertPlexSchema(db);
    const watches = watchStatesByGuid(db);
    const libraryRoots = db
      .prepare(
        `SELECT ls.id AS sectionId, ls.name AS name, ls.section_type AS sectionType,
                sl.root_path AS rootPath
         FROM library_sections ls
         JOIN section_locations sl ON sl.library_section_id = ls.id`,
      )
      .all() as unknown as PlexLibraryRoot[];
    const directories = db
      .prepare(
        `SELECT id, library_section_id AS librarySectionId,
                parent_directory_id AS parentDirectoryId, path
         FROM directories WHERE deleted_at IS NULL`,
      )
      .all() as unknown as PlexDirectory[];
    const externalStreams = db
      .prepare(
        `SELECT id, media_item_id AS mediaItemId, media_part_id AS mediaPartId, url
         FROM media_streams
         WHERE stream_type_id = 3 AND url LIKE 'file://%'`,
      )
      .all() as unknown as PlexExternalStream[];

    const movies = (db.prepare(MOVIE_SQL).all() as unknown as MovieRow[]).map(
      (row) => baseFromRow(row, watches.get(row.guid) ?? []) as PlexMovieFile,
    );
    const episodes = (
      db.prepare(EPISODE_SQL).all() as unknown as EpisodeRow[]
    ).map(
      (row) =>
        ({
          ...baseFromRow(row, watches.get(row.guid) ?? []),
          showId: Number(row.showId),
          showTitle: row.showTitle,
          seasonNumber: Number(row.seasonNumber),
          episodeNumber: Number(row.episodeNumber),
          episodeTitle: row.episodeTitle,
        }) as PlexEpisodeFile,
    );

    return {
      movies,
      episodes,
      directories: directories.map((directory) => ({
        id: Number(directory.id),
        librarySectionId: Number(directory.librarySectionId),
        ...(directory.parentDirectoryId !== undefined &&
        directory.parentDirectoryId !== null
          ? { parentDirectoryId: Number(directory.parentDirectoryId) }
          : {}),
        path: directory.path ?? '',
      })),
      externalStreams: externalStreams.map((stream) => ({
        id: Number(stream.id),
        mediaItemId: Number(stream.mediaItemId),
        ...(stream.mediaPartId !== undefined && stream.mediaPartId !== null
          ? { mediaPartId: Number(stream.mediaPartId) }
          : {}),
        url: stream.url,
      })),
      libraryRoots: libraryRoots.map((root) => ({
        sectionId: Number(root.sectionId),
        name: root.name,
        sectionType: Number(root.sectionType),
        rootPath: root.rootPath,
      })),
    };
  } finally {
    db.close();
  }
}

export interface PlexCatalogLoad {
  catalog?: PlexCatalog;
  /** Why the database could not be read; absent when it was read. */
  error?: Error;
}

/**
 * Copies the database (and any WAL/SHM sidecars) into the app cache so it can
 * be read without write access to Plex's data directory.
 */
function copyDatabase(dbPath: string, cacheDir: string): string | undefined {
  const copyPath = path.join(
    cacheDir,
    `plex-catalog-${randomUUID()}.db`,
  );
  const copied: string[] = [];
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(dbPath, copyPath);
    copied.push(copyPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`;
      if (!fs.existsSync(sidecar)) continue;
      fs.copyFileSync(sidecar, `${copyPath}${suffix}`);
      copied.push(`${copyPath}${suffix}`);
    }
    return copyPath;
  } catch {
    for (const file of copied) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Best effort.
      }
    }
    return undefined;
  }
}

function removeCopy(copyPath: string): void {
  for (const file of [copyPath, `${copyPath}-wal`, `${copyPath}-shm`]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Best effort.
    }
  }
}

/**
 * Reads the Plex catalog for a scan. Even a read-only connection needs to
 * touch the WAL, which fails when Plex's data directory belongs to the Plex
 * service account, so the database is copied into the cache and re-read there.
 */
export function loadPlexCatalog(dbPath: string, cacheDir: string): PlexCatalogLoad {
  try {
    return { catalog: readPlexCatalog(dbPath) };
  } catch (error) {
    const copyPath = copyDatabase(dbPath, cacheDir);
    if (!copyPath) return { error: asError(error) };
    try {
      return { catalog: readPlexCatalog(copyPath) };
    } catch (copyError) {
      return { error: asError(copyError) };
    } finally {
      removeCopy(copyPath);
    }
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function findEpisodeGuid(
  catalog: PlexCatalog,
  showTitle: string,
  seasonNumber: number,
  episodeNumber: number,
): string | undefined {
  const match = catalog.episodes.find(
    (episode) =>
      episode.showTitle.toLowerCase() === showTitle.toLowerCase() &&
      episode.seasonNumber === seasonNumber &&
      episode.episodeNumber === episodeNumber,
  );
  return match?.guid;
}
