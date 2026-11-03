import { describe, expect, it } from 'vitest';
import {
  buildOrganizePlan,
  createNamingRule,
  episodeNameText,
  nameSimilarity,
  parseMediaFilename,
  resolveEpisode,
  scoreEpisode,
  similarity,
  titleComparisonKey,
  type OrganizeSourceFile,
  type TvdbEpisode,
} from '../src/common/organizer';

const episodes: TvdbEpisode[] = [
  {
    tag: 'S01E01',
    name: 'One Ocean',
    seasonNumber: 1,
    episodeNumber: 1,
    airDate: '2017-10-29',
  },
  {
    tag: 'S01E02',
    name: 'The Deep',
    seasonNumber: 1,
    episodeNumber: 2,
    airDate: '2017-11-05',
  },
  {
    tag: 'S01E05',
    name: 'Big Blue',
    seasonNumber: 1,
    episodeNumber: 5,
    airDate: '2017-11-26',
  },
  {
    tag: 'S02E01',
    name: 'One Ocean',
    seasonNumber: 2,
    episodeNumber: 1,
    airDate: '2018-10-28',
  },
];

const SERIES = 'Blue Planet II';

function resolve(filename: string, relativePath = filename) {
  return resolveEpisode(
    parseMediaFilename(filename, relativePath),
    episodes,
    { seriesName: SERIES },
  );
}

describe('episode name extraction', () => {
  it('keeps only the text after the tag and drops the show name', () => {
    const parsed = parseMediaFilename(
      'Blue.Planet.II.S01E02.The.Deep.1080p.WEB-DL.mkv',
    );
    expect(parsed.episodeTitle).toBe('The Deep');
    expect(episodeNameText(parsed, SERIES)).toBe('the deep');
  });

  it('handles a tag at the end and hyphenated episode names', () => {
    expect(
      episodeNameText(
        parseMediaFilename('Blue.Planet.II.The.Deep.S01E02.mkv'),
        SERIES,
      ),
    ).toBe('the deep');
    expect(
      episodeNameText(parseMediaFilename('S01E02 - The Deep.mkv'), SERIES),
    ).toBe('the deep');
  });

  it('treats a tag-only filename as having no episode title', () => {
    expect(
      episodeNameText(parseMediaFilename('Blue.Planet.II.S01E02.mkv'), SERIES),
    ).toBeUndefined();
  });

  it('blends character and token similarity', () => {
    expect(nameSimilarity('The Deep', 'The Deep')).toBe(1);
    expect(nameSimilarity('The Deep', 'Deep')).toBeGreaterThan(0.8);
    expect(nameSimilarity('Big Blue', 'The Deep')).toBeLessThan(0.4);
  });

  it('normalizes the TVDB title on both sides of a comparison', () => {
    expect(similarity("Marvel's Spider-Man", 'Marvels Spider Man')).toBe(1);
    expect(nameSimilarity('Marvels Spider Man', "Marvel's Spider-Man")).toBe(
      1,
    );
  });

  it('builds the same comparison key for raw and normalized titles', () => {
    expect(titleComparisonKey('Leggo My Meg-O')).toBe('leggo my meg o');
    expect(titleComparisonKey('leggo my meg o')).toBe('leggo my meg o');
    expect(titleComparisonKey('Family.Guy.S10E20.mkv')).toBe(
      'family guy s10e20 mkv',
    );
    expect(titleComparisonKey("Marvel's Spider-Man")).toBe(
      'marvels spider man',
    );
  });
});

describe('episode resolution across tag and title states', () => {
  it('tag missing + title missing → no confident match', () => {
    const result = resolve('Blue.Planet.II.mkv');
    expect(result.confidence).toBe(0);
    expect(result.summary).toMatchObject({ tag: 'missing', name: 'missing' });
  });

  it('tag missing + title correct → matches by title only', () => {
    const result = resolve('Blue.Planet.II.The.Deep.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.confidence).toBeCloseTo(0.9, 5);
    expect(result.summary).toMatchObject({
      tag: 'missing',
      name: 'correct',
      conflict: false,
    });
  });

  it('tag missing + title incorrect → low confidence', () => {
    const result = resolve('Blue.Planet.II.Unknown.Title.mkv');
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.summary).toMatchObject({
      tag: 'missing',
      name: 'incorrect',
    });
  });

  it('tag correct + title missing → tag-only match', () => {
    const result = resolve('Blue.Planet.II.S01E02.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.confidence).toBeCloseTo(0.88, 5);
    expect(result.summary).toMatchObject({
      tag: 'correct',
      name: 'missing',
      conflict: false,
    });
  });

  it('tag correct + title correct → strongest match', () => {
    const result = resolve('Blue.Planet.II.S01E02.The.Deep.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.confidence).toBeCloseTo(0.98, 5);
    expect(result.summary).toMatchObject({
      tag: 'correct',
      name: 'correct',
      conflict: false,
    });
  });

  it('tag correct + title incorrect → strong title wins with a conflict label', () => {
    const result = resolve('Blue.Planet.II.S01E02.Big.Blue.mkv');
    expect(result.episode?.tag).toBe('S01E05');
    expect(result.confidence).toBeCloseTo(0.8, 5);
    expect(result.conflict).toBe(true);
    expect(result.conflictKind).toBe('tag-vs-name');
    expect(result.summary).toMatchObject({
      tag: 'incorrect',
      name: 'correct',
    });
  });

  it('tag incorrect + title missing → low confidence', () => {
    const result = resolve('Blue.Planet.II.S01E03.mkv');
    expect(result.confidence).toBeLessThan(0.2);
    expect(result.summary).toMatchObject({
      tag: 'incorrect',
      name: 'missing',
    });
  });

  it('tag incorrect + title correct → title wins with a conflict label', () => {
    const result = resolve('Blue.Planet.II.S01E05.The.Deep.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.confidence).toBeCloseTo(0.8, 5);
    expect(result.conflict).toBe(true);
    expect(result.conflictKind).toBe('tag-vs-name');
    expect(result.summary).toMatchObject({
      tag: 'incorrect',
      name: 'correct',
    });
  });

  it('tag incorrect + title incorrect → lowest confidence', () => {
    const result = resolve('Blue.Planet.II.S01E03.Unknown.Title.mkv');
    expect(result.confidence).toBeLessThan(0.2);
    expect(result.summary).toMatchObject({
      tag: 'incorrect',
      name: 'incorrect',
    });
  });
});

describe('episode tiebreakers', () => {
  it('uses the tag to disambiguate identical episode names', () => {
    const result = resolve('Blue.Planet.II.S02E01.One.Ocean.mkv');
    expect(result.episode?.tag).toBe('S02E01');
    expect(result.conflict).toBe(false);
    expect(result.summary).toMatchObject({
      tag: 'correct',
      name: 'correct',
    });
  });

  it('flags identical episode names without a tag as ambiguous', () => {
    const result = resolve('Blue.Planet.II.One.Ocean.mkv');
    expect(result.conflict).toBe(true);
    expect(result.conflictKind).toBe('ambiguous-name');
    expect(result.confidence).toBeCloseTo(0.45, 5);
  });

  it('uses an air date when tag and title are missing', () => {
    const result = resolve('Blue.Planet.II.2017.11.05.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.confidence).toBeCloseTo(0.9, 5);
    expect(result.summary).toMatchObject({
      tag: 'missing',
      name: 'missing',
      conflict: false,
    });
  });

  it('lets an air date break a tag conflict', () => {
    const result = resolve('Blue.Planet.II.S01E05.2017.11.05.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.conflict).toBe(true);
    expect(result.conflictKind).toBe('tag-vs-air-date');
    expect(result.confidence).toBeCloseTo(0.85, 5);
  });

  it('handles multi-episode tags with one title match', () => {
    const result = resolve('Blue.Planet.II.S01E02E03.The.Deep.mkv');
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.summary).toMatchObject({
      tag: 'correct',
      name: 'correct',
      conflict: false,
    });
  });

  it('strips a numerically different series name', () => {
    const result = resolveEpisode(
      parseMediaFilename('Blue.Planet.2.S01E02.The.Deep.mkv'),
      episodes,
      { seriesName: SERIES },
    );
    expect(result.episode?.tag).toBe('S01E02');
    expect(result.summary?.name).toBe('correct');
  });

  it('matches hyphenated titles split into words', () => {
    const familyGuy: TvdbEpisode[] = [
      {
        tag: 'S10E20',
        name: 'Leggo My Meg-O',
        seasonNumber: 10,
        episodeNumber: 20,
      },
    ];
    const result = resolveEpisode(
      parseMediaFilename('Family.Guy.S10E20.Leggo.My.Meg-O.mkv'),
      familyGuy,
      { seriesName: 'Family Guy' },
    );
    expect(result.episode?.tag).toBe('S10E20');
    expect(result.summary?.name).toBe('correct');
    expect(result.conflict).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('exposes weighted components for the popover', () => {
    const scored = scoreEpisode(
      parseMediaFilename('Blue.Planet.II.S01E02.The.Deep.mkv'),
      episodes[1],
      { seriesName: SERIES },
    );
    expect(scored.evidence.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tag',
          weight: 0.4,
          state: 'correct',
          contribution: 0.4,
        }),
        expect.objectContaining({
          kind: 'name',
          weight: 0.5,
          state: 'correct',
          similarity: 1,
        }),
        expect.objectContaining({
          kind: 'airDate',
          weight: 0.1,
          present: false,
          contribution: 0,
        }),
      ]),
    );
    expect(scored.evidence.coverage).toBeCloseTo(0.9, 5);
  });
});

function file(
  path: string,
  relativePath: string,
  root: string,
): OrganizeSourceFile {
  const filename = path.split(/[\\/]/).pop() ?? path;
  return {
    path,
    root,
    relativePath,
    filename,
    extension: 'mkv',
    size: 100,
  };
}

describe('special episodes and filename safety', () => {
  it('uses S00 and Season 00 for specials', () => {
    const filename = 'Show.Special.1x3.mkv';
    const source = file(
      `/library/Show/Specials/${filename}`,
      `Show/Specials/${filename}`,
      '/library',
    );
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: {
            tag: 'SPECIAL 1x3',
            name: 'Special Title',
            seasonNumber: 0,
            episodeNumber: 3,
          },
          confidence: 1,
          reason: 'Special match',
          seriesName: 'Show',
          showFolder: 'Show',
          showSubpath: 'Show',
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    expect(plan.items[0].targetPath).toBe(
      '/library/Show/Season 00/S00E03 - Special Title.mkv',
    );
  });

  it('strips filesystem-invalid characters from the TVDB title', () => {
    const filename = 'Show.S01E02.mkv';
    const source = file(
      `/library/Show/Season 01/${filename}`,
      `Show/Season 01/${filename}`,
      '/library',
    );
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: {
            tag: 'S01E02',
            name: 'Ocean: The? Deep*',
            seasonNumber: 1,
            episodeNumber: 2,
          },
          confidence: 1,
          reason: 'Test match',
          seriesName: 'Show',
          showFolder: 'Show',
          showSubpath: 'Show',
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    const target = plan.items[0].targetPath;
    expect(target).toBe('/library/Show/Season 01/S01E02 - Ocean - The Deep.mkv');
    const targetFilename = target.split('/').pop() ?? '';
    expect(targetFilename).not.toMatch(/[<>:"\\|?*]/);
  });
});

describe('no-op targets', () => {
  it('skips a TV row whose rendered path is identical', () => {
    const source = file(
      '/library/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
      'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
      '/library',
    );
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: episodes[0],
          confidence: 1,
          reason: 'Tag and title match',
          seriesName: SERIES,
          showFolder: SERIES,
          showSubpath: SERIES,
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    expect(plan.items[0]).toMatchObject({
      action: 'skip',
      reason: 'Already named',
      sidecars: [],
    });
  });

  it('renames only the folder when the file name is already correct', () => {
    const source = file(
      '/library/Family Guy/Season 7/S07E07 - Ocean\'s Three and a Half.mkv',
      'Family Guy/Season 7/S07E07 - Ocean\'s Three and a Half.mkv',
      '/library',
    );
    const familyGuy: TvdbEpisode = {
      tag: 'S07E07',
      name: "Ocean's Three and a Half",
      seasonNumber: 7,
      episodeNumber: 7,
    };
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: familyGuy,
          confidence: 0.2,
          reason: 'Weak title evidence',
          seriesName: 'Family Guy',
          showFolder: 'Family Guy',
          showSubpath: 'Family Guy',
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    expect(plan.items[0]).toMatchObject({
      action: 'rename',
      folderOnly: true,
      reason: 'Folder name updated; file name already correct',
      targetPath:
        "/library/Family Guy/Season 07/S07E07 - Ocean's Three and a Half.mkv",
    });
  });

  it('skips instead of conflicting when the target has the same file name', () => {
    const source = file(
      '/library/Family Guy/Season 7/S07E07 - Ocean\'s Three and a Half.mkv',
      'Family Guy/Season 7/S07E07 - Ocean\'s Three and a Half.mkv',
      '/library',
    );
    const familyGuy: TvdbEpisode = {
      tag: 'S07E07',
      name: "Ocean's Three and a Half",
      seasonNumber: 7,
      episodeNumber: 7,
    };
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library'],
      existingPaths: [
        "/library/Family Guy/Season 07/S07E07 - Ocean's Three and a Half.mkv",
      ],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: familyGuy,
          confidence: 0.98,
          reason: 'Tag and title match',
          seriesName: 'Family Guy',
          showFolder: 'Family Guy',
          showSubpath: 'Family Guy',
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    expect(plan.items[0]).toMatchObject({
      action: 'skip',
      reason: 'Already named',
    });
  });

  it('deduplicates the same source file discovered twice', () => {
    const source = file(
      '/library/Family Guy/Season 7/S07E07 - Ocean\'s Three and a Half.mkv',
      'Family Guy/Season 7/S07E07 - Ocean\'s Three and a Half.mkv',
      '/library',
    );
    const entry = {
      ...source,
      parsed: parseMediaFilename(source.filename, source.relativePath),
      episode: {
        tag: 'S07E07',
        name: "Ocean's Three and a Half",
        seasonNumber: 7,
        episodeNumber: 7,
      },
      confidence: 1,
      reason: 'Tag and title match',
      seriesName: 'Family Guy',
      showFolder: 'Family Guy',
      showSubpath: 'Family Guy',
    };
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library'],
      files: [entry, { ...entry }],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: '{show}/Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].action).toBe('rename');
  });

  it('skips a movie row whose rendered path is identical', () => {
    const source = file(
      '/library/Movies/Same (2008)/Same (2008).mkv',
      'Same (2008)/Same (2008).mkv',
      '/library/Movies',
    );
    const plan = buildOrganizePlan({
      mediaType: 'movies',
      sourceRoots: ['/library/Movies'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          movie: { id: '1', slug: 'same', title: 'Same', year: 2008 },
          confidence: 1,
          reason: 'Title and year match',
        },
      ],
      rules: [
        createNamingRule('movies', {
          fileTemplate: '{title} ({year})',
          folderTemplate: '{title} ({year})',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });

    expect(plan.items[0]).toMatchObject({
      action: 'skip',
      reason: 'Already named',
      sidecars: [],
    });
  });
});
