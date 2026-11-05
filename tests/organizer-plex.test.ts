import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { readPlexCatalog } from '../src/backend/organizer/plex/catalog';
import {
  completePendingHistoryTransfers,
  updatePlexFromPlan,
} from '../src/backend/organizer/plex/writer';
import type { OrganizePlan, OrganizePlanItem } from '../src/common/organizer/types';

let root: string;
let dbPath: string;

const movieSource = () => path.join(root, 'plex', 'Movies', 'Speed Racer', 'Speed.Racer.mkv');
const movieTarget = () =>
  path.join(root, 'plex', 'Movies', 'Speed Racer (2008) [1080p]', 'Speed Racer (2008) [1080p].mkv');

function createPlexFixture(includeEpisodeTwo = true): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE library_sections (id INTEGER PRIMARY KEY, name TEXT, section_type INTEGER);
    CREATE TABLE section_locations (id INTEGER PRIMARY KEY, library_section_id INTEGER, root_path TEXT);
    CREATE TABLE directories (
      id INTEGER PRIMARY KEY, library_section_id INTEGER, parent_directory_id INTEGER,
      path TEXT, created_at TEXT, deleted_at TEXT, updated_at TEXT
    );
    CREATE TABLE metadata_items (
      id INTEGER PRIMARY KEY, library_section_id INTEGER, parent_id INTEGER,
      metadata_type INTEGER, "index" INTEGER, guid TEXT, title TEXT, year INTEGER,
      originally_available_at TEXT, added_at TEXT
    );
    CREATE TABLE media_items (
      id INTEGER PRIMARY KEY, metadata_item_id INTEGER, width INTEGER, height INTEGER
    );
    CREATE TABLE media_parts (
      id INTEGER PRIMARY KEY, media_item_id INTEGER, file TEXT, directory_id INTEGER,
      deleted_at TEXT, updated_at TEXT
    );
    CREATE TABLE media_streams (
      id INTEGER PRIMARY KEY, stream_type_id INTEGER, media_item_id INTEGER,
      media_part_id INTEGER, url TEXT, updated_at TEXT
    );
    CREATE TABLE metadata_item_settings (
      id INTEGER PRIMARY KEY, account_id INTEGER, guid TEXT, view_count INTEGER,
      view_offset INTEGER, last_viewed_at TEXT, skip_count INTEGER, last_skipped_at TEXT,
      rating REAL, last_rated_at TEXT, created_at TEXT, updated_at TEXT, changed_at INTEGER
    );
    CREATE TABLE metadata_item_views (
      id INTEGER PRIMARY KEY, account_id INTEGER, guid TEXT, grandparent_guid TEXT,
      metadata_type INTEGER, title TEXT, parent_title TEXT, grandparent_title TEXT,
      viewed_at TEXT
    );
  `);
  const subtitleUrl = pathToFileURL(
    movieSource().replace(/Speed\.Racer\.mkv$/, 'Speed.Racer.srt'),
  ).href;
  db.exec(`
    INSERT INTO library_sections VALUES (1, 'Movies', 1), (2, 'TV Shows', 2);
    INSERT INTO section_locations VALUES
      (1, 1, '${path.join(root, 'plex', 'Movies')}'),
      (2, 2, '${path.join(root, 'plex', 'TV Shows')}');
    INSERT INTO directories (id, library_section_id, parent_directory_id, path, deleted_at, updated_at) VALUES
      (1, 1, NULL, '', NULL, NULL),
      (100, 1, 1, 'Speed Racer', NULL, NULL),
      (2, 2, NULL, '', NULL, NULL),
      (200, 2, 2, 'Blue Planet II', NULL, NULL);
    INSERT INTO metadata_items VALUES
      (10, 1, NULL, 1, 1, 'plex://movie/1', 'Speed Racer', 2008, 1210291200, '2021-01-08 20:14:57'),
      (40, 2, NULL, 2, 1, 'plex://show/1', 'Blue Planet II', 2017, 1509235200, '2021-01-08 20:14:57'),
      (41, 2, 40, 3, 1, 'plex://season/1', '', 2017, NULL, '2021-01-08 20:14:57'),
      (42, 2, 41, 4, 1, 'plex://episode/1', 'One Ocean', 2017, 1509235200, '2021-01-08 20:14:57'),
      (43, 2, 41, 4, 2, 'plex://episode/2', 'The Deep', 2017, 1509840000, '2021-01-08 20:14:57');
    INSERT INTO media_items VALUES
      (20, 10, 1920, 1080), (50, 42, 3840, 2160), (52, 43, 3840, 2160);
    INSERT INTO media_parts VALUES
      (30, 20, '${movieSource()}', 100, NULL, NULL),
      (51, 50, '${path.join(root, 'plex', 'TV Shows', 'Blue Planet II', 'E01.mkv')}', 200, NULL, NULL),
      (53, 52, '${path.join(root, 'plex', 'TV Shows', 'Blue Planet II', 'E02.mkv')}', 200, NULL, NULL);
    INSERT INTO media_streams VALUES
      (60, 3, 20, 30, '${subtitleUrl}', NULL);
    INSERT INTO metadata_item_settings VALUES
      (1, 1, 'plex://movie/1', 1, 1000, '2021-01-08 20:14:57', 0, NULL, NULL, NULL, '2021-01-01', NULL, 1),
      (2, 1, 'plex://episode/1', 2, 500, '2021-01-08 20:14:57', 0, NULL, NULL, NULL, '2021-01-01', NULL, 1);
    INSERT INTO metadata_item_views VALUES
      (1, 1, 'plex://movie/1', NULL, 1, 'Speed Racer', NULL, NULL, '2021-01-08 20:14:57'),
      (2, 1, 'plex://episode/1', 'plex://show/1', 4, 'One Ocean', NULL, 'Blue Planet II', '2021-01-08 20:14:57');
  `);
  if (!includeEpisodeTwo) {
    db.exec("DELETE FROM metadata_items WHERE id = 43; DELETE FROM media_items WHERE id = 52;");
  }
  db.close();
}

function moviePlan(): OrganizePlan {
  const item: OrganizePlanItem = {
    id: movieSource(),
    mediaType: 'movies',
    sourcePath: movieSource(),
    targetPath: movieTarget(),
    relativeTarget: 'Speed Racer (2008) [1080p]/Speed Racer (2008) [1080p].mkv',
    action: 'rename',
    confidence: 1,
    reason: 'Plex metadata',
    plex: {
      metadataItemId: 10,
      mediaItemId: 20,
      mediaPartId: 30,
      guid: 'plex://movie/1',
      title: 'Speed Racer',
      librarySectionId: 1,
      libraryRoot: path.join(root, 'plex', 'Movies'),
      directoryId: 100,
      directoryPath: 'Speed Racer',
      watchCount: 1,
      watchStates: [],
    },
    sidecars: [
      {
        sourcePath: path.join(root, 'plex', 'Movies', 'Speed Racer', 'Speed.Racer.srt'),
        targetPath: path.join(
          root,
          'plex',
          'Movies',
          'Speed Racer (2008) [1080p]',
          'Speed Racer (2008) [1080p].srt',
        ),
      },
    ],
  };
  return {
    mediaType: 'movies',
    sourceRoots: [path.join(root, 'plex', 'Movies')],
    items: [item],
    createdAt: new Date().toISOString(),
    warnings: [],
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-plex-'));
  dbPath = path.join(root, 'com.plexapp.plugins.library.db');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Plex catalog', () => {
  it('reads movies, episodes, directories, streams and watch counts', () => {
    createPlexFixture();
    const catalog = readPlexCatalog(dbPath);
    expect(catalog.movies).toHaveLength(1);
    expect(catalog.movies[0]).toMatchObject({
      title: 'Speed Racer',
      year: 2008,
      width: 1920,
      height: 1080,
      airDate: '2008-05-09',
      watchCount: 1,
      directoryId: 100,
    });
    expect(catalog.episodes).toHaveLength(2);
    expect(catalog.episodes[0]).toMatchObject({
      showTitle: 'Blue Planet II',
      seasonNumber: 1,
      episodeNumber: 1,
      width: 3840,
      height: 2160,
      airDate: '2017-10-29',
      watchCount: 2,
    });
    expect(catalog.directories.some((entry) => entry.path === 'Speed Racer')).toBe(true);
    expect(catalog.externalStreams).toHaveLength(1);
  });
});

describe('Plex writer', () => {
  it('updates movie paths, directory rows and subtitle URLs without touching watch state', () => {
    createPlexFixture();
    const result = updatePlexFromPlan(moviePlan(), {
      dbPath,
      backupDir: path.join(root, 'backups'),
      pendingPath: path.join(root, 'pending.json'),
      platform: 'linux',
      caseInsensitive: false,
    });
    expect(result.updated).toBe(1);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const part = db.prepare('SELECT file FROM media_parts WHERE id = 30').get() as {
        file: string;
      };
      expect(part.file).toBe(movieTarget());
      const directory = db
        .prepare('SELECT path FROM directories WHERE id = 100')
        .get() as { path: string };
      expect(directory.path).toBe('Speed Racer (2008) [1080p]');
      const stream = db.prepare('SELECT url FROM media_streams WHERE id = 60').get() as {
        url: string;
      };
      expect(decodeURIComponent(stream.url)).toContain('Speed Racer (2008) [1080p].srt');
      const setting = db
        .prepare("SELECT view_count FROM metadata_item_settings WHERE guid = 'plex://movie/1'")
        .get() as { view_count: number };
      expect(setting.view_count).toBe(1);
      const added = db
        .prepare('SELECT added_at FROM metadata_items WHERE id = 10')
        .get() as { added_at: string };
      expect(added.added_at).toBe('2021-01-08 20:14:57');
    } finally {
      db.close();
    }
  });

  it('creates a season directory and moves watch history to the correct episode', () => {
    createPlexFixture();
    const source = path.join(root, 'plex', 'TV Shows', 'Blue Planet II', 'E01.mkv');
    const target = path.join(
      root,
      'plex',
      'TV Shows',
      'Blue Planet II',
      'Season 01',
      'S01E02 - The Deep.mkv',
    );
    const plan: OrganizePlan = {
      mediaType: 'tv',
      sourceRoots: [path.join(root, 'plex', 'TV Shows', 'Blue Planet II')],
      items: [
        {
          id: source,
          mediaType: 'tv',
          sourcePath: source,
          targetPath: target,
          relativeTarget: 'Season 01/S01E02 - The Deep.mkv',
          action: 'rename',
          confidence: 1,
          reason: 'TVDB match',
          episode: {
            tag: 'S01E02',
            name: 'The Deep',
            seasonNumber: 1,
            episodeNumber: 2,
          },
          plex: {
            metadataItemId: 42,
            mediaItemId: 50,
            mediaPartId: 51,
            guid: 'plex://episode/1',
            seasonNumber: 1,
            episodeNumber: 1,
            showId: 40,
            showTitle: 'Blue Planet II',
            librarySectionId: 2,
            libraryRoot: path.join(root, 'plex', 'TV Shows'),
            directoryId: 200,
            directoryPath: 'Blue Planet II',
            watchCount: 2,
            watchStates: [],
          },
          sidecars: [],
        },
      ],
      createdAt: new Date().toISOString(),
      warnings: [],
    };

    const result = updatePlexFromPlan(plan, {
      dbPath,
      backupDir: path.join(root, 'backups'),
      pendingPath: path.join(root, 'pending.json'),
      platform: 'linux',
      caseInsensitive: false,
    });
    expect(result.updated).toBe(1);
    expect(result.historyMoved).toBeGreaterThan(0);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const part = db
        .prepare('SELECT file, directory_id AS directoryId FROM media_parts WHERE id = 51')
        .get() as { file: string; directoryId: number };
      expect(part.file).toBe(target);
      const directory = db
        .prepare('SELECT path FROM directories WHERE id = ?')
        .get(part.directoryId) as { path: string };
      expect(directory.path).toBe('Blue Planet II/Season 01');
      const newSetting = db
        .prepare("SELECT view_count FROM metadata_item_settings WHERE guid = 'plex://episode/2'")
        .get() as { view_count: number } | undefined;
      expect(newSetting?.view_count).toBe(2);
      const oldSetting = db
        .prepare("SELECT view_count FROM metadata_item_settings WHERE guid = 'plex://episode/1'")
        .get() as { view_count: number } | undefined;
      expect(oldSetting).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('updates every part and moves history for a multi-episode range', () => {
    createPlexFixture();
    const source = path.join(
      root,
      'plex',
      'TV Shows',
      'Blue Planet II',
      'Blue.Planet.II.S01E01-E02.mkv',
    );
    const target = path.join(
      root,
      'plex',
      'TV Shows',
      'Blue Planet II',
      'Season 01',
      'S01E03-E04 - Coral Reefs.mkv',
    );
    const db = new DatabaseSync(dbPath);
    db.exec(`
      UPDATE media_parts SET file = '${source}' WHERE id IN (51, 53);
      INSERT INTO metadata_items VALUES
        (44, 2, 41, 4, 3, 'plex://episode/3', 'Coral Reefs', 2017, NULL, '2021-01-08 20:14:57'),
        (45, 2, 41, 4, 4, 'plex://episode/4', 'Big Blue', 2017, NULL, '2021-01-08 20:14:57');
      INSERT INTO media_items VALUES (54, 44, 3840, 2160), (56, 45, 3840, 2160);
      INSERT INTO media_parts VALUES
        (55, 54, '${path.join(root, 'plex', 'TV Shows', 'Blue Planet II', 'E03.mkv')}', 200, NULL, NULL),
        (57, 56, '${path.join(root, 'plex', 'TV Shows', 'Blue Planet II', 'E04.mkv')}', 200, NULL, NULL);
      INSERT INTO metadata_item_settings VALUES
        (3, 1, 'plex://episode/2', 3, 700, '2021-01-09 20:14:57', 0, NULL, NULL, NULL, '2021-01-02', NULL, 1);
    `);
    db.close();

    const association = (partId: number, episodeNumber: number) => ({
      metadataItemId: 42,
      mediaItemId: 50,
      mediaPartId: partId,
      guid: `plex://episode/${episodeNumber}`,
      seasonNumber: 1,
      episodeNumber,
      showId: 40,
      showTitle: 'Blue Planet II',
      librarySectionId: 2,
      libraryRoot: path.join(root, 'plex', 'TV Shows'),
      directoryId: 200,
      directoryPath: 'Blue Planet II',
      watchCount: 0,
      watchStates: [],
    });
    const plan: OrganizePlan = {
      mediaType: 'tv',
      sourceRoots: [path.join(root, 'plex', 'TV Shows', 'Blue Planet II')],
      items: [
        {
          id: source,
          mediaType: 'tv',
          sourcePath: source,
          targetPath: target,
          relativeTarget: 'Season 01/S01E03-E04 - Coral Reefs.mkv',
          action: 'rename',
          confidence: 1,
          reason: 'Manual multi-episode match',
          episode: {
            tag: 'S01E03',
            name: 'Coral Reefs',
            seasonNumber: 1,
            episodeNumber: 3,
          },
          episodes: [
            {
              tag: 'S01E03',
              name: 'Coral Reefs',
              seasonNumber: 1,
              episodeNumber: 3,
            },
            {
              tag: 'S01E04',
              name: 'Big Blue',
              seasonNumber: 1,
              episodeNumber: 4,
            },
          ],
          plex: association(51, 1),
          plexEpisodes: [association(51, 1), association(53, 2)],
          sidecars: [],
        },
      ],
      createdAt: new Date().toISOString(),
      warnings: [],
    };

    const result = updatePlexFromPlan(plan, {
      dbPath,
      backupDir: path.join(root, 'backups'),
      pendingPath: path.join(root, 'pending.json'),
      platform: 'linux',
      caseInsensitive: false,
    });
    expect(result.updated).toBe(2);
    expect(result.historyMoved).toBeGreaterThan(0);

    const updated = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const parts = updated
        .prepare('SELECT id, file FROM media_parts WHERE id IN (51, 53) ORDER BY id')
        .all() as unknown as { id: number; file: string }[];
      expect(parts.map((part) => part.file)).toEqual([target, target]);

      const third = updated
        .prepare("SELECT view_count FROM metadata_item_settings WHERE guid = 'plex://episode/3'")
        .get() as { view_count: number } | undefined;
      const fourth = updated
        .prepare("SELECT view_count FROM metadata_item_settings WHERE guid = 'plex://episode/4'")
        .get() as { view_count: number } | undefined;
      expect(third?.view_count).toBe(2);
      expect(fourth?.view_count).toBe(3);

      const old = updated
        .prepare("SELECT COUNT(*) AS count FROM metadata_item_settings WHERE guid IN ('plex://episode/1', 'plex://episode/2')")
        .get() as { count: number };
      expect(old.count).toBe(0);
    } finally {
      updated.close();
    }
  });

  it('queues a history transfer when the correct episode does not exist yet', () => {
    createPlexFixture(false);
    const pendingPath = path.join(root, 'pending.json');
    const source = path.join(root, 'plex', 'TV Shows', 'Blue Planet II', 'E01.mkv');
    const target = path.join(
      root,
      'plex',
      'TV Shows',
      'Blue Planet II',
      'Season 01',
      'S01E02 - The Deep.mkv',
    );
    const plan: OrganizePlan = {
      mediaType: 'tv',
      sourceRoots: [path.join(root, 'plex', 'TV Shows', 'Blue Planet II')],
      items: [
        {
          id: source,
          mediaType: 'tv',
          sourcePath: source,
          targetPath: target,
          relativeTarget: 'Season 01/S01E02 - The Deep.mkv',
          action: 'rename',
          confidence: 1,
          reason: 'TVDB match',
          episode: {
            tag: 'S01E02',
            name: 'The Deep',
            seasonNumber: 1,
            episodeNumber: 2,
          },
          plex: {
            metadataItemId: 42,
            mediaItemId: 50,
            mediaPartId: 51,
            guid: 'plex://episode/1',
            seasonNumber: 1,
            episodeNumber: 1,
            showId: 40,
            showTitle: 'Blue Planet II',
            librarySectionId: 2,
            libraryRoot: path.join(root, 'plex', 'TV Shows'),
            directoryId: 200,
            directoryPath: 'Blue Planet II',
            watchCount: 2,
            watchStates: [],
          },
          sidecars: [],
        },
      ],
      createdAt: new Date().toISOString(),
      warnings: [],
    };
    const result = updatePlexFromPlan(plan, {
      dbPath,
      backupDir: path.join(root, 'backups'),
      pendingPath,
      platform: 'linux',
      caseInsensitive: false,
    });
    expect(result.pendingTransfers).toBe(1);
    expect(JSON.parse(fs.readFileSync(pendingPath, 'utf8'))).toHaveLength(1);

    // Plex scans the new file and creates the missing episode item.
    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO metadata_items VALUES
        (44, 2, 41, 4, 2, 'plex://episode/3', 'The Deep', 2017, NULL, '2021-01-08 20:14:57');
      INSERT INTO media_items VALUES (54, 44, 3840, 2160);
      INSERT INTO media_parts VALUES (55, 54, '${target}', 200, NULL, NULL);
    `);
    db.close();

    const completed = completePendingHistoryTransfers({
      dbPath,
      backupDir: path.join(root, 'backups'),
      pendingPath,
      platform: 'linux',
      caseInsensitive: false,
    });
    expect(completed.historyMoved).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(pendingPath, 'utf8'))).toHaveLength(0);
  });
});
