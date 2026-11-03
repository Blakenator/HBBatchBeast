import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { createNamingRule, createOrganizeSettings } from '../src/common/organizer/settings';
import type { OrganizeScanProgress } from '../src/common/organizer/types';
import type { TvdbClient } from '../src/backend/organizer/tvdb/client';

let root: string;
let showFolder: string;
let paths: ReturnType<typeof appPaths>;

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
  searchSeries: async (query: string) => [
    query.toLowerCase().includes('blue')
      ? { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II', year: 2017 }
      : { id: '2', slug: 'planet-earth', name: 'Planet Earth', year: 2006 },
  ],
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
      fs.existsSync(path.join(showFolder, 'Blue.Planet.II.S01E01.One.Ocean.mkv')),
    ).toBe(true);
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
    expect(detected.folders.map((folder) => folder.series?.slug).sort()).toEqual([
      'blue-planet-ii',
      'planet-earth',
    ]);
    expect(detected.folders.every((folder) => folder.autoMatched)).toBe(true);
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
      events.some((event) => event.phase === 'discovering' && event.discovered === 1),
    ).toBe(true);
    expect(
      plan.items.some((item) => item.sourcePath.includes('Show B')),
    ).toBe(false);
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
    expect(
      matching.find((event) => event.completed === 1)?.currentShow,
    ).toBe('Blue Planet II');

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
