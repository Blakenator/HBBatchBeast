import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appPaths, ensureAppFolders } from '../src/backend/helpers/appPaths';
import {
  applyOrganizePlan,
  buildOrganizePlanForLibrary,
  detectShowFolders,
  readOrganizeJournal,
  undoLastOrganize,
} from '../src/backend/organizer/service';
import { emptyLibrary } from '../src/common/library';
import {
  createNamingRule,
  createOrganizeSettings,
} from '../src/common/organizer/settings';
import { setOverride } from '../src/common/organizer/overrides';
import { splitTargetsForItem } from '../src/common/organizer/split';
import type {
  OrganizeApplyProgress,
  OrganizePlanItem,
  OrganizeScanProgress,
} from '../src/common/organizer/types';
import type { TvdbClient } from '../src/backend/organizer/tvdb/client';

let root: string;
let showFolder: string;
let paths: ReturnType<typeof appPaths>;

const seriesResults = (query: string) => [
  query.toLowerCase().includes('blue')
    ? { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II', year: 2017 }
    : { id: '2', slug: 'planet-earth', name: 'Planet Earth', year: 2006 },
];

const fakeClient = {
  loadEpisodes: async () => [
    {
      tag: 'S01E01',
      name: 'One Ocean',
      seasonNumber: 1,
      episodeNumber: 1,
    },
  ],
  searchMovies: async () => [],
  searchSeries: async (query: string) => seriesResults(query),
  searchMany: async (queries: string[]) =>
    queries.map((query) => ({ series: seriesResults(query), movies: [] })),
} as unknown as TvdbClient;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-organize-'));
  showFolder = path.join(root, 'library', 'Blue Planet II');
  fs.mkdirSync(showFolder, { recursive: true });
  fs.writeFileSync(
    path.join(showFolder, 'Blue.Planet.II.S01E01.One.Ocean.mkv'),
    'video',
  );
  fs.writeFileSync(
    path.join(showFolder, 'Blue.Planet.II.S01E01.One.Ocean.en.srt'),
    'subtitle',
  );
  paths = appPaths({
    userDataPath: path.join(root, 'userData'),
    logsPath: path.join(root, 'logs'),
  });
  ensureAppFolders(paths);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function library() {
  const base = emptyLibrary({ id: 'lib-1', name: 'TV', mediaType: 'tv' });
  const settings = createOrganizeSettings('tv');
  settings.tvdb = {
    shows: [
      {
        id: 'show-1',
        folderId: 'folder-1',
        subpath: '',
        series: { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
      },
    ],
  };
  return {
    ...base,
    folders: [{ id: 'folder-1', source: showFolder, destination: '' }],
    organize: settings,
  };
}

describe('organize service', () => {
  it('plans a manual multi-episode match as a range', async () => {
    const lib = library();
    const multiPath = path.join(showFolder, 'Blue.Planet.II.S01E02-E03.mkv');
    fs.writeFileSync(multiPath, 'video');
    const first = {
      tag: 'S01E02',
      name: 'The Deep',
      seasonNumber: 1,
      episodeNumber: 2,
    };
    const second = {
      tag: 'S01E03',
      name: 'Coral Reefs',
      seasonNumber: 1,
      episodeNumber: 3,
    };
    const settings = setOverride(
      lib.organize!,
      multiPath,
      { episode: first, episodes: [first, second] },
      false,
    );

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
    });

    const item = plan.items.find(
      (candidate) => candidate.sourcePath === multiPath,
    );
    expect(item?.episodes).toEqual([first, second]);
    expect(item?.targetPath).toBe(
      path.join(
        showFolder,
        'Season 01',
        'S01E02-E03 - The Deep, Coral Reefs.mkv',
      ),
    );
  });

  it('auto-detects a filename range and joins both titles', async () => {
    const lib = library();
    const multiPath = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    fs.writeFileSync(multiPath, 'video');
    const multiClient = {
      ...fakeClient,
      loadEpisodes: async () => [
        {
          tag: 'S01E01',
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: 1,
        },
        {
          tag: 'S01E02',
          name: 'The Deep',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
    } as unknown as TvdbClient;

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: multiClient,
      probeMedia: async () => ({}),
    });

    const item = plan.items.find(
      (candidate) => candidate.sourcePath === multiPath,
    );
    expect(item?.episodes?.map((episode) => episode.tag)).toEqual([
      'S01E01',
      'S01E02',
    ]);
    expect(item?.targetPath).toBe(
      path.join(
        showFolder,
        'Season 01',
        'S01E01-E02 - One Ocean, The Deep.mkv',
      ),
    );
  });

  it('auto-detects a run from joined episode titles', async () => {
    const lib = library();
    const multiPath = path.join(
      showFolder,
      'Blue.Planet.II.S01E01.One.Ocean.and.The.Deep.mkv',
    );
    fs.writeFileSync(multiPath, 'video');
    const multiClient = {
      ...fakeClient,
      loadEpisodes: async () => [
        {
          tag: 'S01E01',
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: 1,
        },
        {
          tag: 'S01E02',
          name: 'The Deep',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
    } as unknown as TvdbClient;

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: multiClient,
      probeMedia: async () => ({}),
    });

    const item = plan.items.find(
      (candidate) => candidate.sourcePath === multiPath,
    );
    expect(item?.episodes?.map((episode) => episode.tag)).toEqual([
      'S01E01',
      'S01E02',
    ]);
    expect(item?.action).toBe('rename');
    expect(item?.episodeMatch).toMatchObject({
      name: 'correct',
      conflict: false,
    });
    expect(item?.targetPath).toBe(
      path.join(
        showFolder,
        'Season 01',
        'S01E01-E02 - One Ocean, The Deep.mkv',
      ),
    );
  });

  it('does not stretch a single-episode title onto the next episode', async () => {
    const lib = library();
    const singlePath = path.join(
      showFolder,
      'Blue.Planet.II.S01E02.The.Deep.mkv',
    );
    fs.writeFileSync(singlePath, 'video');
    const multiClient = {
      ...fakeClient,
      loadEpisodes: async () => [
        {
          tag: 'S01E01',
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: 1,
        },
        {
          tag: 'S01E02',
          name: 'The Deep',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
    } as unknown as TvdbClient;

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: multiClient,
      probeMedia: async () => ({}),
    });

    const item = plan.items.find(
      (candidate) => candidate.sourcePath === singlePath,
    );
    expect(item?.episodes).toBeUndefined();
    expect(item?.targetPath).toBe(
      path.join(showFolder, 'Season 01', 'S01E02 - The Deep.mkv'),
    );
  });

  it('keeps scanning when the Plex database cannot be read', async () => {
    const lib = library();
    const brokenDb = path.join(root, 'broken-plex.db');
    fs.writeFileSync(brokenDb, 'not a plex database');

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      plexDbPath: brokenDb,
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].action).toBe('rename');
    expect(plan.warnings.join('\n')).toMatch(/Plex metadata was unavailable/);
  });

  it('warns when Plex uses TMDB episode ordering', async () => {
    const lib = library();
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      catalog: {
        movies: [],
        episodes: [],
        directories: [],
        externalStreams: [],
        libraryRoots: [
          {
            sectionId: 2,
            name: 'TV Shows',
            sectionType: 2,
            rootPath: showFolder,
            showOrdering: 'tmdbAiring',
          },
        ],
      },
    });

    expect(plan.warnings.join('\n')).toMatch(/TMDB episode ordering/);
    expect(plan.warnings.join('\n')).toMatch(/TheTVDB \(Aired\)/);
  });

  it('does not warn when Plex uses a TVDB episode order', async () => {
    const lib = library();
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      catalog: {
        movies: [],
        episodes: [],
        directories: [],
        externalStreams: [],
        libraryRoots: [
          {
            sectionId: 2,
            name: 'TV Shows',
            sectionType: 2,
            rootPath: showFolder,
            showOrdering: 'aired',
          },
        ],
      },
    });

    expect(plan.warnings.join('\n')).not.toMatch(/TMDB episode ordering/);
  });

  it('scans, plans sidecars and applies file moves with a journal', async () => {
    const lib = library();
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({ height: 2160 }),
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      action: 'rename',
      targetPath: path.join(showFolder, 'Season 01', 'S01E01 - One Ocean.mkv'),
    });
    expect(plan.items[0].confidence).toBeCloseTo(0.98, 5);
    expect(plan.items[0].episodeMatch).toMatchObject({
      tag: 'correct',
      name: 'correct',
      conflict: false,
    });
    expect(plan.items[0].sidecars).toHaveLength(1);
    expect(plan.items[0].sidecars[0].targetPath).toBe(
      path.join(showFolder, 'Season 01', 'S01E01 - One Ocean.en.srt'),
    );

    const result = await applyOrganizePlan({
      plan,
      settings: lib.organize!,
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
    });
    expect(result.failed).toEqual([]);
    expect(result.renamed).toHaveLength(1);
    expect(
      fs.existsSync(
        path.join(showFolder, 'Season 01', 'S01E01 - One Ocean.mkv'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(showFolder, 'Season 01', 'S01E01 - One Ocean.en.srt'),
      ),
    ).toBe(true);
    expect(readOrganizeJournal(paths)?.status).toBe('applied');

    const undone = await undoLastOrganize(paths);
    expect(undone.reversed).toBe(1);
    expect(
      fs.existsSync(
        path.join(showFolder, 'Blue.Planet.II.S01E01.One.Ocean.mkv'),
      ),
    ).toBe(true);
  });

  it('refuses a Plex update when the database folder is read-only', async () => {
    if (process.getuid?.() === 0) return; // root ignores the folder mode
    const folder = path.join(root, 'plex-databases');
    fs.mkdirSync(folder, { recursive: true });
    const dbPath = path.join(folder, 'com.plexapp.plugins.library.db');
    fs.writeFileSync(dbPath, 'database');
    fs.chmodSync(folder, 0o555);
    try {
      await expect(
        applyOrganizePlan({
          plan: {
            mediaType: 'tv',
            sourceRoots: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            warnings: [],
            items: [],
          },
          settings: createOrganizeSettings('tv'),
          appPaths: paths,
          // Unknown platforms skip the service probe, keeping this deterministic.
          platform: 'freebsd',
          updatePlex: true,
          plexDbPath: dbPath,
        }),
      ).rejects.toThrow(/cannot write the Plex database/i);
    } finally {
      fs.chmodSync(folder, 0o755);
    }
    // Nothing ran, so no journal was written and no file was touched.
    expect(readOrganizeJournal(paths)).toBeUndefined();
  });

  it('re-walks only the folders selected for a partial rescan', async () => {
    const tvRoot = path.join(root, 'rescan-tv');
    const season = path.join(tvRoot, 'Blue Planet II', 'Season 01');
    const otherShow = path.join(tvRoot, 'Planet Earth');
    fs.mkdirSync(season, { recursive: true });
    fs.mkdirSync(otherShow, { recursive: true });
    fs.writeFileSync(path.join(season, 'S01E01.mkv'), 'video');
    fs.writeFileSync(path.join(otherShow, 'S01E01.mkv'), 'video');

    const lib = {
      ...emptyLibrary({ id: 'lib-rescan', name: 'TV', mediaType: 'tv' }),
      folders: [{ id: 'root-folder', source: tvRoot, destination: '' }],
      organize: createOrganizeSettings('tv'),
    };
    lib.organize!.tvdb = {
      shows: [
        {
          id: 'show-1',
          folderId: 'root-folder',
          subpath: 'Blue Planet II',
          series: {
            id: '1',
            slug: 'blue-planet-ii',
            name: 'Blue Planet II',
          },
        },
        {
          id: 'show-2',
          folderId: 'root-folder',
          subpath: 'Planet Earth',
          series: { id: '2', slug: 'planet-earth', name: 'Planet Earth' },
        },
      ],
    };

    // A file added after the first scan must show up on the next partial walk.
    fs.writeFileSync(path.join(season, 'S01E02.mkv'), 'video');

    const rescanned = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      rescanFolders: [season],
    });

    expect(rescanned.items.map((item) => item.id).sort()).toEqual([
      path.join(season, 'S01E01.mkv'),
      path.join(season, 'S01E02.mkv'),
    ]);
    expect(rescanned.sourceRoots).toEqual([tvRoot]);
  });

  it('returns nothing when a rescan folder is outside the library', async () => {
    const lib = library();
    const rescanned = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      rescanFolders: [path.join(root, 'elsewhere')],
    });

    expect(rescanned.items).toEqual([]);
    expect(rescanned.warnings.join('\n')).toMatch(
      /None of the selected folders are part of this library/,
    );
  });

  it('detects every show folder under a library root and matches it', async () => {
    const tvRoot = path.join(root, 'tv');
    const blue = path.join(tvRoot, 'Blue.Planet.II.2017.1080p');
    const earth = path.join(tvRoot, 'Planet Earth (2006)');
    fs.mkdirSync(path.join(blue, 'Season 1'), { recursive: true });
    fs.mkdirSync(earth, { recursive: true });
    fs.writeFileSync(path.join(blue, 'Season 1', 'S01E01.mkv'), 'video');
    fs.writeFileSync(path.join(earth, 'Episode1.mkv'), 'video');

    const lib = {
      ...emptyLibrary({ id: 'lib-tv', name: 'TV root', mediaType: 'tv' }),
      folders: [{ id: 'root-folder', source: tvRoot, destination: '' }],
      organize: createOrganizeSettings('tv'),
    };
    const detected = await detectShowFolders({
      library: lib,
      settings: lib.organize,
      home: root,
      tvdbClient: fakeClient,
    });

    expect(detected.folders.map((folder) => folder.subpath).sort()).toEqual([
      'Blue.Planet.II.2017.1080p',
      'Planet Earth (2006)',
    ]);
    expect(
      detected.folders.map((folder) => folder.series?.slug).sort(),
    ).toEqual(['blue-planet-ii', 'planet-earth']);
    expect(detected.folders.every((folder) => folder.autoMatched)).toBe(true);
  });

  it('batches show folder searches through searchMany', async () => {
    const tvRoot = path.join(root, 'tv-batch');
    for (const show of ['Blue Planet II', 'Planet Earth']) {
      fs.mkdirSync(path.join(tvRoot, show), { recursive: true });
      fs.writeFileSync(path.join(tvRoot, show, 'S01E01.mkv'), 'video');
    }
    const lib = {
      ...emptyLibrary({ id: 'lib-batch', name: 'Batch', mediaType: 'tv' }),
      folders: [{ id: 'folder-batch', source: tvRoot, destination: '' }],
      organize: createOrganizeSettings('tv'),
    };
    const searchMany = vi.fn(async (queries: string[]) =>
      queries.map((query) => ({ series: seriesResults(query), movies: [] })),
    );
    const client = {
      ...fakeClient,
      searchMany,
    } as unknown as TvdbClient;

    const detected = await detectShowFolders({
      library: lib,
      settings: lib.organize,
      home: root,
      tvdbClient: client,
    });

    expect(detected.folders).toHaveLength(2);
    expect(searchMany).toHaveBeenCalledTimes(1);
    expect(searchMany.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(['Blue Planet II', 'Planet Earth']),
    );
  });

  it('applies name replacements to show detection queries', async () => {
    const tvRoot = path.join(root, 'tv-replaced');
    const showDir = path.join(tvRoot, 'DW');
    fs.mkdirSync(showDir, { recursive: true });
    fs.writeFileSync(path.join(showDir, 'S01E01.mkv'), 'video');
    const settings = {
      ...createOrganizeSettings('tv'),
      nameReplacements: [{ id: 'r1', find: 'DW', replace: 'Doctor Who' }],
    };
    const lib = {
      ...emptyLibrary({
        id: 'lib-replaced',
        name: 'Replaced',
        mediaType: 'tv',
      }),
      folders: [{ id: 'folder-replaced', source: tvRoot, destination: '' }],
      organize: settings,
    };
    const searchMany = vi.fn(async (queries: string[]) =>
      queries.map((query) => ({
        series: [{ id: '1', slug: 'doctor-who', name: query, year: 2005 }],
        movies: [],
      })),
    );
    const client = { ...fakeClient, searchMany } as unknown as TvdbClient;

    const detected = await detectShowFolders({
      library: lib,
      settings,
      home: root,
      tvdbClient: client,
    });

    expect(searchMany.mock.calls[0]?.[0]).toEqual(['Doctor Who']);
    expect(detected.folders[0]?.series?.slug).toBe('doctor-who');
  });

  it('treats a folder with a root mapping as a single show', async () => {
    const tvRoot = path.join(root, 'tv-single');
    fs.mkdirSync(path.join(tvRoot, 'Season 01'), { recursive: true });
    fs.writeFileSync(path.join(tvRoot, 'Season 01', 'S01E01.mkv'), 'video');

    const settings = createOrganizeSettings('tv');
    settings.tvdb = {
      shows: [
        {
          id: 'show-root',
          folderId: 'root-folder',
          subpath: '',
          series: { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
        },
      ],
    };
    const lib = {
      ...emptyLibrary({ id: 'lib-single', name: 'Single', mediaType: 'tv' }),
      folders: [{ id: 'root-folder', source: tvRoot, destination: '' }],
      organize: settings,
    };
    const detected = await detectShowFolders({
      library: lib,
      settings,
      home: root,
      tvdbClient: fakeClient,
    });

    expect(detected.folders).toHaveLength(1);
    expect(detected.folders[0]).toMatchObject({
      subpath: '',
      mediaCount: 1,
      series: expect.objectContaining({ slug: 'blue-planet-ii' }),
    });
  });

  it('plans nested show folders into their own season folders', async () => {
    const tvRoot = path.join(root, 'tv-nested');
    const blue = path.join(tvRoot, 'Blue Planet II');
    fs.mkdirSync(blue, { recursive: true });
    fs.writeFileSync(path.join(blue, 'S01E01.mkv'), 'video');

    const settings = createOrganizeSettings('tv');
    settings.tvdb = {
      shows: [
        {
          id: 'show-1',
          folderId: 'root-folder',
          subpath: 'Blue Planet II',
          series: { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
        },
      ],
    };
    const lib = {
      ...emptyLibrary({ id: 'lib-tv-2', name: 'TV root', mediaType: 'tv' }),
      folders: [{ id: 'root-folder', source: tvRoot, destination: '' }],
      organize: settings,
    };
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
    });

    expect(plan.items[0].targetPath).toBe(
      path.join(blue, 'Season 01', 'S01E01 - One Ocean.mkv'),
    );
    expect(plan.items[0].showFolder).toBe('Blue Planet II');
  });

  it('scopes discovery and matching to one show folder', async () => {
    const tvRoot = path.join(root, 'tv-scope');
    const showA = path.join(tvRoot, 'Show A');
    const showB = path.join(tvRoot, 'Show B');
    fs.mkdirSync(path.join(showA, 'Season 01'), { recursive: true });
    fs.mkdirSync(path.join(showB, 'Season 01'), { recursive: true });
    fs.writeFileSync(path.join(showA, 'Season 01', 'S01E01.mkv'), 'video');
    fs.writeFileSync(path.join(showB, 'Season 01', 'S01E01.mkv'), 'video');

    const settings = createOrganizeSettings('tv');
    settings.tvdb = {
      shows: [
        {
          id: 'show-a',
          folderId: 'root-folder',
          subpath: 'Show A',
          series: { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
        },
        {
          id: 'show-b',
          folderId: 'root-folder',
          subpath: 'Show B',
          series: { id: '2', slug: 'planet-earth', name: 'Planet Earth' },
        },
      ],
    };
    const lib = {
      ...emptyLibrary({ id: 'lib-scope', name: 'Scope', mediaType: 'tv' }),
      folders: [{ id: 'root-folder', source: tvRoot, destination: '' }],
      organize: settings,
    };
    const events: OrganizeScanProgress[] = [];
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      scope: [{ folderId: 'root-folder', subpath: 'Show A', name: 'Show A' }],
      onProgress: (progress) => events.push(progress),
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].sourcePath).toBe(
      path.join(showA, 'Season 01', 'S01E01.mkv'),
    );
    expect(
      events.some(
        (event) => event.phase === 'discovering' && event.discovered === 1,
      ),
    ).toBe(true);
    expect(plan.items.some((item) => item.sourcePath.includes('Show B'))).toBe(
      false,
    );
  });

  it('scans only the selected subset of shows', async () => {
    const tvRoot = path.join(root, 'tv-subset');
    const names = ['Show A', 'Show B', 'Show C'];
    for (const name of names) {
      fs.mkdirSync(path.join(tvRoot, name, 'Season 01'), { recursive: true });
      fs.writeFileSync(path.join(tvRoot, name, 'Season 01', 'S01E01.mkv'), 'v');
    }
    const settings = createOrganizeSettings('tv');
    settings.tvdb = {
      shows: names.map((name, index) => ({
        id: `show-${index}`,
        folderId: 'root-folder',
        subpath: name,
        series: { id: String(index), slug: `show-${index}`, name },
      })),
    };
    const lib = {
      ...emptyLibrary({ id: 'lib-subset', name: 'Subset', mediaType: 'tv' }),
      folders: [{ id: 'root-folder', source: tvRoot, destination: '' }],
      organize: settings,
    };
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({}),
      scope: [
        { folderId: 'root-folder', subpath: 'Show A', name: 'Show A' },
        { folderId: 'root-folder', subpath: 'Show C', name: 'Show C' },
      ],
    });

    expect(plan.items).toHaveLength(2);
    expect(plan.items.map((item) => item.sourcePath).sort()).toEqual([
      path.join(tvRoot, 'Show A', 'Season 01', 'S01E01.mkv'),
      path.join(tvRoot, 'Show C', 'Season 01', 'S01E01.mkv'),
    ]);
    expect(plan.items.some((item) => item.sourcePath.includes('Show B'))).toBe(
      false,
    );
  });

  it('uses probed frame dimensions in templates', async () => {
    const lib = library();
    lib.organize = {
      ...lib.organize!,
      namingRules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {width}x{height}.{ext}',
          folderTemplate: 'Season {season:02}',
        }),
      ],
    };
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({ width: 1920, height: 1080 }),
    });

    expect(plan.items[0].parsed).toMatchObject({
      width: 1920,
      height: 1080,
      resolution: '1080p',
    });
    expect(plan.items[0].targetPath).toBe(
      path.join(showFolder, 'Season 01', 'S01E01 - 1920x1080.mkv'),
    );
  });

  it('buckets letterboxed frames with the same Plex rule', async () => {
    const lib = library();
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({ width: 1920, height: 800 }),
    });

    expect(plan.items[0].parsed).toMatchObject({
      width: 1920,
      height: 800,
      resolution: '1080p',
    });
  });

  it('streams discovery, matching and planning progress', async () => {
    const lib = library();
    const events: OrganizeScanProgress[] = [];
    await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => ({ height: 1080 }),
      onProgress: (progress) => events.push(progress),
    });

    expect(events.length).toBeGreaterThan(3);
    expect(events[0].phase).toBe('discovering');
    expect(
      events.some(
        (event) =>
          event.phase === 'discovering' &&
          event.discovered === 1 &&
          event.currentFile?.endsWith('Blue.Planet.II.S01E01.One.Ocean.mkv'),
      ),
    ).toBe(true);

    const matching = events.filter((event) => event.phase === 'matching');
    expect(matching[0]).toMatchObject({ completed: 0, total: 1 });
    expect(matching.some((event) => event.completed === 1)).toBe(true);
    expect(matching.find((event) => event.completed === 1)?.currentShow).toBe(
      'Blue Planet II',
    );

    expect(events[events.length - 1]).toMatchObject({
      phase: 'planning',
      completed: 1,
      total: 1,
      discovered: 1,
    });
    expect(events.every((event) => event.elapsedMs >= 0)).toBe(true);
  });

  it('reports a missing series instead of guessing', async () => {
    const lib = library();
    lib.organize = createOrganizeSettings('tv');
    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
    });
    expect(plan.items[0].action).toBe('skip');
    expect(plan.warnings.join(' ')).toContain('TVDB series');
  });
});

describe('organize scan caching and matching', () => {
  it('reuses discovery and probe data when only naming changes', async () => {
    const lib = library();
    let probes = 0;
    const first = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      probeMedia: async () => {
        probes += 1;
        return { height: 2160 };
      },
    });
    expect(first.scanId).toBeTruthy();
    expect(probes).toBe(1);

    const settings = {
      ...lib.organize!,
      namingRules: [
        createNamingRule('tv', {
          fileTemplate: '{tag}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
    };
    const nextLibrary = { ...lib, organize: settings };
    const second = await buildOrganizePlanForLibrary({
      library: nextLibrary,
      settings,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: fakeClient,
      reuseScanId: first.scanId,
      probeMedia: async () => {
        probes += 1;
        return { height: 2160 };
      },
    });

    expect(probes).toBe(1);
    expect(second.scanId).toBe(first.scanId);
    expect(second.items[0].targetPath).toBe(
      path.join(showFolder, 'Season 01', 'S01E01.mkv'),
    );
  });

  it('probes and matches files with bounded concurrency', async () => {
    for (const episode of [2, 3, 4]) {
      fs.writeFileSync(
        path.join(showFolder, `Blue.Planet.II.S01E0${episode}.Ocean.mkv`),
        'video',
      );
    }
    const lib = library();
    const episodes = [1, 2, 3, 4].map((episode) => ({
      tag: `S01E0${episode}`,
      name: `Ocean ${episode}`,
      seasonNumber: 1,
      episodeNumber: episode,
    }));
    const client = {
      loadEpisodes: async () => episodes,
      searchMovies: async () => [],
      searchSeries: async (query: string) => seriesResults(query),
      searchMany: async (queries: string[]) =>
        queries.map((query) => ({ series: seriesResults(query), movies: [] })),
    } as unknown as TvdbClient;
    let active = 0;
    let peak = 0;

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: client,
      matchConcurrency: 2,
      probeMedia: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { height: 1080 };
      },
    });

    expect(plan.items).toHaveLength(4);
    expect(peak).toBe(2);
  });

  it('aggregates per-file movie lookup failures into one warning', async () => {
    const movieRoot = path.join(root, 'movies');
    fs.mkdirSync(movieRoot, { recursive: true });
    fs.writeFileSync(path.join(movieRoot, 'First.Movie.2001.mkv'), 'video');
    fs.writeFileSync(path.join(movieRoot, 'Second.Movie.2002.mkv'), 'video');
    const lib = emptyLibrary({
      id: 'movies-1',
      name: 'Movies',
      mediaType: 'movies',
    });
    lib.folders = [{ id: 'folder-1', source: movieRoot, destination: '' }];
    const client = {
      searchMany: async () => {
        throw new Error('TVDB down');
      },
      searchMovies: async () => {
        throw new Error('TVDB down');
      },
      searchSeries: async () => [],
      loadEpisodes: async () => [],
    } as unknown as TvdbClient;

    const plan = await buildOrganizePlanForLibrary({
      library: lib,
      settings: lib.organize,
      appPaths: paths,
      platform: 'linux',
      home: root,
      tvdbClient: client,
      probeMedia: async () => ({ height: 1080 }),
    });

    expect(
      plan.warnings.filter((warning) =>
        warning.includes('TVDB movie lookup(s) failed'),
      ),
    ).toEqual(['2 TVDB movie lookup(s) failed (TVDB down).']);
    expect(plan.warnings.join(' ')).not.toContain('First.Movie.2001.mkv');
  });
});

describe('split apply', () => {
  const ep1 = {
    tag: 'S01E01',
    name: 'One Ocean',
    seasonNumber: 1,
    episodeNumber: 1,
  };
  const ep2 = {
    tag: 'S01E02',
    name: 'The Deep',
    seasonNumber: 1,
    episodeNumber: 2,
  };
  const ep3 = {
    tag: 'S01E03',
    name: 'Coral Cities',
    seasonNumber: 1,
    episodeNumber: 3,
  };
  const ep4 = {
    tag: 'S01E04',
    name: 'Big Blue',
    seasonNumber: 1,
    episodeNumber: 4,
  };

  it('splits a multi-episode row, journals the outputs and undoes them', async () => {
    const multi = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    fs.writeFileSync(multi, 'multi');
    const sourceRoot = path.join(root, 'library');
    const item: OrganizePlanItem = {
      id: multi,
      mediaType: 'tv',
      sourcePath: multi,
      sourceRoot,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      targetPath: multi,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      action: 'skip',
      confidence: 1,
      reason: 'Already named',
      sidecars: [],
      parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
      showFolder: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
      seriesName: 'Blue Planet II',
      episode: ep1,
      episodes: [ep1, ep2],
    };
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [sourceRoot],
      items: [item],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const split = {
      itemId: multi,
      sourcePath: multi,
      fileSize: 5,
      fileDurationSeconds: 120,
      episodeDurationsSeconds: [60, 60],
      estimate: { method: 'tvdb' as const, slackSeconds: 0 },
      cutMode: 'copy' as const,
      originalPolicy: 'keep' as const,
      sidecarPolicy: 'leave' as const,
      segments: [
        { index: 0, startSeconds: 0, endSeconds: 60, episode: ep1 },
        { index: 1, startSeconds: 60, endSeconds: 120, episode: ep2 },
      ],
      updatedAt: 1,
    };

    const result = await applyOrganizePlan({
      plan,
      splits: [split],
      settings: createOrganizeSettings('tv'),
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
      splitConcurrency: 1,
      deps: {
        ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
        splitFile: async (task) => {
          const outputs = task.segments.map((segment) => {
            const targetPath = segment.targetPath as string;
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, 'segment');
            return { targetPath, segment };
          });
          return {
            sourcePath: task.plan.sourcePath,
            outputs,
            originalKept: true,
            warnings: [],
          };
        },
      },
    });

    expect(result.failed).toEqual([]);
    expect(result.splits).toHaveLength(1);
    const outputs = result.splits[0].outputs;
    expect(outputs).toHaveLength(2);
    expect(outputs[0].replace(/\\/g, '/')).toContain(
      'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );
    expect(outputs[1].replace(/\\/g, '/')).toContain(
      'Blue Planet II/Season 01/S01E02 - The Deep.mkv',
    );
    expect(result.renamed).toEqual(expect.arrayContaining(outputs));
    expect(fs.existsSync(outputs[0])).toBe(true);
    expect(fs.existsSync(multi)).toBe(true);

    const journal = readOrganizeJournal(paths);
    expect(journal?.version).toBe(2);
    expect(journal?.splits).toHaveLength(1);

    const undone = await undoLastOrganize(paths);
    expect(undone.reversed).toBe(1);
    expect(fs.existsSync(outputs[0])).toBe(false);
    expect(fs.existsSync(outputs[1])).toBe(false);
    expect(fs.existsSync(multi)).toBe(true);
  });

  it('reports result-file progress instead of source-file tasks', async () => {
    const multi = path.join(showFolder, 'Blue.Planet.II.S01E01-E04.mkv');
    fs.writeFileSync(multi, 'multi');
    const sourceRoot = path.join(root, 'library');
    const item: OrganizePlanItem = {
      id: multi,
      mediaType: 'tv',
      sourcePath: multi,
      sourceRoot,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E04.mkv',
      targetPath: multi,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E04.mkv',
      action: 'skip',
      confidence: 1,
      reason: 'Already named',
      sidecars: [],
      parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
      showFolder: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
      seriesName: 'Blue Planet II',
      episode: ep1,
      episodes: [ep1, ep2, ep3, ep4],
    };
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [sourceRoot],
      items: [item],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const split = {
      itemId: multi,
      sourcePath: multi,
      fileSize: 5,
      fileDurationSeconds: 120,
      episodeDurationsSeconds: [30, 30, 30, 30],
      estimate: { method: 'tvdb' as const, slackSeconds: 0 },
      cutMode: 'copy' as const,
      originalPolicy: 'keep' as const,
      sidecarPolicy: 'leave' as const,
      segments: [
        { index: 0, startSeconds: 0, endSeconds: 30, episode: ep1 },
        { index: 1, startSeconds: 30, endSeconds: 60, episode: ep2 },
        { index: 2, startSeconds: 60, endSeconds: 90, episode: ep3 },
        { index: 3, startSeconds: 90, endSeconds: 120, episode: ep4 },
      ],
      updatedAt: 1,
    };
    const events: OrganizeApplyProgress[] = [];

    const result = await applyOrganizePlan({
      plan,
      splits: [split],
      settings: createOrganizeSettings('tv'),
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
      splitConcurrency: 1,
      onProgress: (progress) => events.push(progress),
      deps: {
        ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
        splitFile: async (task, deps) => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          deps.onProgress?.(0.15);
          await new Promise((resolve) => setTimeout(resolve, 120));
          const outputs = task.segments.map((segment) => {
            const targetPath = segment.targetPath as string;
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, 'segment');
            return { targetPath, segment };
          });
          return {
            sourcePath: task.plan.sourcePath,
            outputs,
            originalKept: true,
            warnings: [],
          };
        },
      },
    });

    expect(result.failed).toEqual([]);
    // A 15% split of one source file into four outputs reads as partial
    // result-file progress, not one completed source file.
    expect(
      events.some(
        (event) =>
          event.total === 4 &&
          event.completed > 0 &&
          event.completed < 4 &&
          event.etaMs !== undefined,
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ total: 4, completed: 4 });
  });

  it('applies the original-file policy when a segment is dropped', async () => {
    const multi = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    fs.writeFileSync(multi, 'multi');
    const sourceRoot = path.join(root, 'library');
    const ep1 = {
      tag: 'S01E01',
      name: 'One Ocean',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const ep2 = {
      tag: 'S01E02',
      name: 'The Deep',
      seasonNumber: 1,
      episodeNumber: 2,
    };
    const item: OrganizePlanItem = {
      id: multi,
      mediaType: 'tv',
      sourcePath: multi,
      sourceRoot,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      targetPath: multi,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      action: 'skip',
      confidence: 1,
      reason: 'Already named',
      sidecars: [],
      parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
      showFolder: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
      seriesName: 'Blue Planet II',
      episode: ep1,
      episodes: [ep1, ep2],
    };
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [sourceRoot],
      items: [item],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const split = {
      itemId: multi,
      sourcePath: multi,
      fileSize: 5,
      fileDurationSeconds: 120,
      estimate: { method: 'tvdb' as const },
      cutMode: 'exact' as const,
      originalPolicy: 'delete' as const,
      sidecarPolicy: 'leave' as const,
      segments: [
        { index: 0, startSeconds: 0, endSeconds: 60, episode: ep1 },
        { index: 1, startSeconds: 60, endSeconds: 120, episode: ep2 },
      ],
      skippedSegments: [1],
      updatedAt: 1,
    };
    const settings = createOrganizeSettings('tv');
    const targets = splitTargetsForItem(item, split.segments, {
      settings,
      mediaType: 'tv',
      caseInsensitive: false,
    }).targets;
    const runFfmpeg = async (args: readonly string[]) => {
      const output = args[args.length - 1];
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'segment');
      return { stdout: '', stderr: '' };
    };

    const result = await applyOrganizePlan({
      plan,
      splits: [split],
      settings,
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
      deps: {
        ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
        runFfmpeg,
      },
    });

    expect(result.failed).toEqual([]);
    expect(result.splits[0].outputs).toEqual([targets[0] as string]);
    expect(fs.existsSync(targets[0] as string)).toBe(true);
    expect(fs.existsSync(targets[1] as string)).toBe(false);
    expect(fs.existsSync(multi)).toBe(false);
    expect(readOrganizeJournal(paths)?.splits?.[0].originalPolicy).toBe(
      'delete',
    );

    const undone = await undoLastOrganize(paths);
    expect(undone.warnings.join('\n')).toMatch(/deleted/i);
    expect(fs.existsSync(targets[0] as string)).toBe(true);
  });

  it('treats a split row rename target as superseded for other splits', async () => {
    const multiA = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    const multiB = path.join(showFolder, 'Blue.Planet.II.S01E03-E04.mkv');
    fs.writeFileSync(multiA, 'multi-a');
    fs.writeFileSync(multiB, 'multi-b');
    const sourceRoot = path.join(root, 'library');
    const makeEpisode = (number: number) => ({
      tag: `S01E0${number}`,
      name: `Episode ${number}`,
      seasonNumber: 1,
      episodeNumber: number,
    });
    const ep1 = makeEpisode(1);
    const ep2 = makeEpisode(2);
    const ep3 = makeEpisode(3);
    const ep4 = makeEpisode(4);
    const base = {
      mediaType: 'tv' as const,
      sourceRoot,
      action: 'skip' as const,
      confidence: 1,
      reason: 'Already named',
      sidecars: [],
      parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
      showFolder: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
      seriesName: 'Blue Planet II',
    };
    const itemA: OrganizePlanItem = {
      ...base,
      id: multiA,
      sourcePath: multiA,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      targetPath: multiA,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      episode: ep1,
      episodes: [ep1, ep2],
    };
    const itemB: OrganizePlanItem = {
      ...base,
      id: multiB,
      sourcePath: multiB,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E03-E04.mkv',
      targetPath: multiB,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E03-E04.mkv',
      episode: ep3,
      episodes: [ep3, ep4],
    };
    const settings = createOrganizeSettings('tv');
    const segmentsFor = (
      episodes: {
        tag: string;
        name: string;
        seasonNumber: number;
        episodeNumber: number;
      }[],
    ) =>
      episodes.map((episode, index) => ({
        index,
        startSeconds: index * 60,
        endSeconds: (index + 1) * 60,
        episode,
      }));
    const splitA = {
      itemId: multiA,
      sourcePath: multiA,
      fileSize: fs.statSync(multiA).size,
      fileDurationSeconds: 120,
      estimate: { method: 'tvdb' as const },
      cutMode: 'exact' as const,
      originalPolicy: 'keep' as const,
      sidecarPolicy: 'leave' as const,
      segments: segmentsFor([ep1, ep2]),
      updatedAt: 1,
    };
    const splitB = {
      ...splitA,
      itemId: multiB,
      sourcePath: multiB,
      fileSize: fs.statSync(multiB).size,
      segments: segmentsFor([ep3, ep4]),
    };
    const targetsA = splitTargetsForItem(itemA, splitA.segments, {
      settings,
      mediaType: 'tv',
      caseInsensitive: false,
    }).targets;
    // B still carries its pre-split rename target, which happens to equal A's
    // first output. It is superseded by B's split and must not block A.
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [sourceRoot],
      items: [
        itemA,
        {
          ...itemB,
          action: 'conflict',
          targetPath: targetsA[0] as string,
          relativeTarget: 'Blue Planet II/Season 01/S01E01.mkv',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const runFfmpeg = async (args: readonly string[]) => {
      const output = args[args.length - 1];
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'segment');
      return { stdout: '', stderr: '' };
    };

    const result = await applyOrganizePlan({
      plan,
      splits: [splitA, splitB],
      settings,
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
      deps: {
        ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
        runFfmpeg,
      },
    });

    expect(result.failed).toEqual([]);
    expect(result.splits).toHaveLength(2);
  });

  it('replaces an existing target only with the overwrite flag and restores it on undo', async () => {
    const multi = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    fs.writeFileSync(multi, 'multi');
    const sourceRoot = path.join(root, 'library');
    const ep1 = {
      tag: 'S01E01',
      name: 'One Ocean',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const ep2 = {
      tag: 'S01E02',
      name: 'The Deep',
      seasonNumber: 1,
      episodeNumber: 2,
    };
    const item: OrganizePlanItem = {
      id: multi,
      mediaType: 'tv',
      sourcePath: multi,
      sourceRoot,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      targetPath: multi,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      action: 'skip',
      confidence: 1,
      reason: 'Already named',
      sidecars: [],
      parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
      showFolder: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
      seriesName: 'Blue Planet II',
      episode: ep1,
      episodes: [ep1, ep2],
    };
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [sourceRoot],
      items: [item],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const split = {
      itemId: multi,
      sourcePath: multi,
      fileSize: 5,
      fileDurationSeconds: 120,
      estimate: { method: 'tvdb' as const },
      cutMode: 'exact' as const,
      originalPolicy: 'keep' as const,
      sidecarPolicy: 'leave' as const,
      segments: [
        { index: 0, startSeconds: 0, endSeconds: 60, episode: ep1 },
        { index: 1, startSeconds: 60, endSeconds: 120, episode: ep2 },
      ],
      updatedAt: 1,
    };
    const settings = createOrganizeSettings('tv');
    const targets = splitTargetsForItem(item, split.segments, {
      settings,
      mediaType: 'tv',
      caseInsensitive: false,
    }).targets;
    fs.mkdirSync(path.dirname(targets[0] as string), { recursive: true });
    fs.writeFileSync(targets[0] as string, 'old episode');
    const runFfmpeg = async (args: readonly string[]) => {
      const output = args[args.length - 1];
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'segment');
      return { stdout: '', stderr: '' };
    };
    const deps = {
      ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
      runFfmpeg,
    };

    await expect(
      applyOrganizePlan({
        plan,
        splits: [split],
        settings,
        appPaths: paths,
        platform: 'linux',
        updatePlex: false,
        deps,
      }),
    ).rejects.toThrow(/Target already exists/);
    expect(fs.readFileSync(targets[0] as string, 'utf8')).toBe('old episode');

    const result = await applyOrganizePlan({
      plan,
      splits: [{ ...split, overwrite: true }],
      settings,
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
      deps,
    });
    expect(result.failed).toEqual([]);
    expect(fs.readFileSync(targets[0] as string, 'utf8')).toBe('segment');
    const recorded = readOrganizeJournal(paths)?.splits?.[0];
    expect(recorded?.outputs[0].replacedBackupPath).toBeTruthy();
    expect(
      fs.readFileSync(
        recorded?.outputs[0].replacedBackupPath as string,
        'utf8',
      ),
    ).toBe('old episode');

    await undoLastOrganize(paths);
    expect(fs.readFileSync(targets[0] as string, 'utf8')).toBe('old episode');
    expect(fs.existsSync(targets[1] as string)).toBe(false);
    expect(fs.existsSync(multi)).toBe(true);
  });

  it('journals split subtitle outputs and restores backed-up sidecars on undo', async () => {
    const multi = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    fs.writeFileSync(multi, 'multi');
    const subtitle = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.en.srt');
    fs.writeFileSync(subtitle, 'subtitle');
    const sourceRoot = path.join(root, 'library');
    const item: OrganizePlanItem = {
      id: multi,
      mediaType: 'tv',
      sourcePath: multi,
      sourceRoot,
      sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      targetPath: multi,
      relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
      action: 'skip',
      confidence: 1,
      reason: 'Already named',
      sidecars: [{ sourcePath: subtitle, targetPath: subtitle }],
      parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
      showFolder: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
      seriesName: 'Blue Planet II',
      episode: ep1,
      episodes: [ep1, ep2],
    };
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [sourceRoot],
      items: [item],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const split = {
      itemId: multi,
      sourcePath: multi,
      fileSize: 5,
      fileDurationSeconds: 120,
      episodeDurationsSeconds: [60, 60],
      estimate: { method: 'tvdb' as const, slackSeconds: 0 },
      cutMode: 'exact' as const,
      originalPolicy: 'backup' as const,
      sidecarPolicy: 'split' as const,
      segments: [
        { index: 0, startSeconds: 0, endSeconds: 60, episode: ep1 },
        { index: 1, startSeconds: 60, endSeconds: 120, episode: ep2 },
      ],
      updatedAt: 1,
    };
    const fakeRun = async (args: readonly string[]) => {
      const output = args[args.length - 1];
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'data');
      return { stdout: '', stderr: '' };
    };

    const result = await applyOrganizePlan({
      plan,
      splits: [split],
      settings: createOrganizeSettings('tv'),
      appPaths: paths,
      platform: 'linux',
      updatePlex: false,
      deps: {
        ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
        runFfmpeg: fakeRun,
      },
    });
    expect(result.failed).toEqual([]);
    expect(result.splits).toHaveLength(1);
    const journal = readOrganizeJournal(paths);
    const recorded = journal?.splits?.[0];
    expect(recorded?.sidecarOutputs).toHaveLength(2);
    expect(recorded?.sidecarBackups).toHaveLength(1);
    expect(fs.existsSync(subtitle)).toBe(false);
    for (const sidecar of recorded?.sidecarOutputs ?? []) {
      expect(fs.existsSync(sidecar)).toBe(true);
    }
    expect(fs.existsSync(recorded?.sidecarBackups?.[0].backupPath ?? '')).toBe(
      true,
    );

    await undoLastOrganize(paths);
    expect(fs.existsSync(multi)).toBe(true);
    expect(fs.readFileSync(subtitle, 'utf8')).toBe('subtitle');
    for (const output of recorded?.outputs ?? []) {
      expect(fs.existsSync(output.targetPath)).toBe(false);
    }
    for (const sidecar of recorded?.sidecarOutputs ?? []) {
      expect(fs.existsSync(sidecar)).toBe(false);
    }
  });

  it('rejects a stale split fingerprint before touching files', async () => {
    const multi = path.join(showFolder, 'Blue.Planet.II.S01E01-E02.mkv');
    fs.writeFileSync(multi, 'multi');
    const plan = {
      mediaType: 'tv' as const,
      sourceRoots: [path.join(root, 'library')],
      items: [
        {
          id: multi,
          mediaType: 'tv' as const,
          sourcePath: multi,
          sourceRoot: path.join(root, 'library'),
          sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
          targetPath: multi,
          relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
          action: 'skip' as const,
          sidecars: [],
          episode: ep1,
          episodes: [ep1, ep2],
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    };
    const split = {
      itemId: multi,
      sourcePath: multi,
      fileSize: 999,
      fileDurationSeconds: 120,
      estimate: { method: 'tvdb' as const },
      cutMode: 'copy' as const,
      originalPolicy: 'keep' as const,
      sidecarPolicy: 'leave' as const,
      segments: [
        { index: 0, startSeconds: 0, endSeconds: 60, episode: ep1 },
        { index: 1, startSeconds: 60, endSeconds: 120, episode: ep2 },
      ],
      updatedAt: 1,
    };
    await expect(
      applyOrganizePlan({
        plan,
        splits: [split],
        settings: createOrganizeSettings('tv'),
        appPaths: paths,
        platform: 'linux',
        updatePlex: false,
        deps: {
          ffmpegStatus: async () => ({ available: true, path: 'ffmpeg' }),
        },
      }),
    ).rejects.toThrow(/changed since the split was planned/i);
    expect(fs.existsSync(multi)).toBe(true);
    expect(readOrganizeJournal(paths)).toBeUndefined();
  });
});
