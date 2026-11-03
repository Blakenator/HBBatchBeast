import { describe, expect, it } from 'vitest';
import {
  buildOrganizePlan,
  createNamingRule,
  createOrganizeSettings,
  episodeTag,
  isCaseOnlyDifference,
  parseMediaFilename,
  rankEpisodes,
  rankMovies,
  renderFileTemplate,
  renderFolderTemplate,
  renderTemplate,
  resolutionLabel,
  resolveOrganizeSettings,
  sanitizePathSegment,
  selectNamingRule,
  organizerComparisonKey,
  type NamingRule,
  type OrganizeSourceFile,
  type TvdbEpisode,
  type TvdbMovie,
} from '../src/common/organizer';
import { migrateAppConfig } from '../src/common/configMigration';
import {
  APP_CONFIG_SCHEMA_VERSION,
  emptyLibrary,
} from '../src/common/library';

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
    tag: 'S02E01',
    name: 'One Ocean',
    seasonNumber: 2,
    episodeNumber: 1,
    airDate: '2018-10-28',
  },
];

function file(
  path: string,
  relativePath = path,
  root = path.slice(0, Math.max(0, path.lastIndexOf('/'))),
): OrganizeSourceFile {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return {
    path,
    root,
    relativePath,
    filename,
    extension,
    size: 100,
  };
}

describe('organize path helpers', () => {
  it('sanitizes Windows-invalid characters and reserved names', () => {
    expect(sanitizePathSegment('Movie: The Sequel')).toBe('Movie - The Sequel');
    expect(sanitizePathSegment('CON')).toBe('_CON');
    expect(sanitizePathSegment('Trailing. ')).toBe('Trailing');
    expect(sanitizePathSegment('a<b>c|d?e*f')).toBe('abcdef');
    expect(sanitizePathSegment('..')).toBe('');
  });

  it('renders padded tokens and rejects unknown tokens', () => {
    expect(renderTemplate('Season {season:02}', { season: 3 })).toBe(
      'Season 03',
    );
    expect(() => renderTemplate('{missing}', {})).toThrow(/Unknown template/);
  });

  it('renders named token variants and rejects unknown ones', () => {
    expect(
      renderTemplate('{airDate:short}/{width}x{height}', {
        airDate: '2017-10-29',
        width: 1920,
        height: 1080,
      }),
    ).toBe('2017-10/1920x1080');
    expect(() => renderTemplate('{airDate:bogus}', { airDate: '' })).toThrow(
      /Unknown template token variant/,
    );
  });

  it('keeps folder templates relative', () => {
    expect(renderFolderTemplate('Season {season:02}', { season: 2 })).toEqual([
      'Season 02',
    ]);
    expect(() => renderFolderTemplate('../escape', {})).toThrow();
    expect(() => renderFolderTemplate('/absolute', {})).toThrow();
  });

  it('compares case-insensitively only when requested', () => {
    expect(
      organizerComparisonKey('/Movies/Film.mkv', { caseInsensitive: true }),
    ).toBe('/movies/film.mkv');
    expect(organizerComparisonKey('/Movies/Film.mkv')).toBe('/Movies/Film.mkv');
    expect(
      isCaseOnlyDifference('/Movies/Film.mkv', '/Movies/film.mkv', {
        caseInsensitive: true,
      }),
    ).toBe(true);
  });
});

describe('filename parsing', () => {
  it('parses SxxEyy tags and release noise', () => {
    const parsed = parseMediaFilename(
      'Blue.Planet.II.S01E01.One.Ocean.2017.2160p.UHD.BluRay.x265.mkv',
    );
    expect(parsed).toMatchObject({
      seasonNumber: 1,
      episodeNumber: 1,
      year: 2017,
      resolution: '4K',
    });
    expect(parsed.title).toContain('Blue Planet II');
  });

  it('parses explicit frame dimensions', () => {
    expect(parseMediaFilename('Arrival.2016.1920x1080.BluRay.mkv')).toMatchObject(
      {
        width: 1920,
        height: 1080,
        resolution: '1080p',
      },
    );
    expect(parseMediaFilename('Arrival.2016.1920x1080.mkv').title).toBe(
      'Arrival',
    );
  });

  it('maps heights to resolution buckets inclusively', () => {
    expect(resolutionLabel(2160)).toBe('4K');
    expect(resolutionLabel(1440)).toBe('1440p');
    expect(resolutionLabel(1080)).toBe('1080p');
    expect(resolutionLabel(720)).toBe('720p');
    expect(resolutionLabel(576)).toBe('576p');
    expect(resolutionLabel(480)).toBe('480p');
    expect(resolutionLabel(360)).toBe('SD');
    expect(resolutionLabel(undefined, '1080p')).toBe('1080p');
  });

  it('parses 1x02, specials and multi-episode names', () => {
    expect(parseMediaFilename('Show 1x02.mkv')).toMatchObject({
      seasonNumber: 1,
      episodeNumber: 2,
    });
    expect(parseMediaFilename('Show Special 1x3.mkv')).toMatchObject({
      seasonNumber: 0,
      episodeNumber: 3,
      isSpecial: true,
    });
    expect(
      parseMediaFilename('Show.S02E03E04.mkv').episodeNumbers,
    ).toEqual([3, 4]);
  });

  it('uses a season folder when the file only has an episode number', () => {
    expect(
      parseMediaFilename('E05.mkv', 'Show/Season 2/E05.mkv'),
    ).toMatchObject({ seasonNumber: 2, episodeNumber: 5 });
  });

  it('forces a Specials folder to season 0', () => {
    expect(
      parseMediaFilename('S01E05.mkv', 'Show/Specials/S01E05.mkv'),
    ).toMatchObject({
      seasonNumber: 0,
      episodeNumber: 5,
      isSpecial: true,
    });
    expect(
      parseMediaFilename('E02.mkv', 'Show/Specials/E02.mkv'),
    ).toMatchObject({
      seasonNumber: 0,
      episodeNumber: 2,
      isSpecial: true,
    });
  });
});

describe('matching', () => {
  it('prefers an explicit tag over title similarity', () => {
    const parsed = parseMediaFilename('Show.S02E01.mkv');
    const [best] = rankEpisodes(parsed, episodes);
    expect(best.episode).toMatchObject({ seasonNumber: 2, episodeNumber: 1 });
    expect(best.confidence).toBeCloseTo(0.88, 5);
    expect(best.evidence).toMatchObject({
      tag: 'correct',
      name: 'missing',
      coverage: 0.4,
    });
  });

  it('falls back to episode-title similarity', () => {
    const parsed = parseMediaFilename('The Deep.mkv');
    const [best] = rankEpisodes(parsed, episodes);
    expect(best.episode.name).toBe('The Deep');
    expect(best.confidence).toBeGreaterThan(0.6);
  });

  it('scores movies by title and year', () => {
    const movies: TvdbMovie[] = [
      { id: '1', slug: 'speed-racer', title: 'Speed Racer', year: 2008 },
      { id: '2', slug: 'speed-racer-1967', title: 'Speed Racer', year: 1967 },
    ];
    const parsed = parseMediaFilename('Speed.Racer.2008.1080p.BluRay.mkv');
    const [best] = rankMovies(parsed, movies);
    expect(best.movie.id).toBe('1');
    expect(best.confidence).toBeGreaterThan(0.9);
  });

  it('normalizes punctuation and apostrophes in TVDB movie titles', () => {
    const movies: TvdbMovie[] = [
      {
        id: '1',
        slug: 'spider-man',
        title: "Marvel's Spider-Man",
        year: 2018,
      },
    ];
    const parsed = parseMediaFilename('Marvels.Spider.Man.2018.mkv');
    const [best] = rankMovies(parsed, movies);
    expect(best.movie.id).toBe('1');
    expect(best.confidence).toBeGreaterThan(0.9);
  });
});

describe('naming rules', () => {
  const defaultRule = createNamingRule('tv', {
    fileTemplate: '{tag} - {name}.{ext}',
    folderTemplate: 'Season {season:02}',
  });

  it('selects the first matching rule and falls back to the default', () => {
    const rules: NamingRule[] = [
      {
        id: 'high',
        match: 'all',
        conditions: [
          { field: 'resolution', operator: 'is', value: '4K' },
        ],
        fileTemplate: '4K-{tag}.{ext}',
        folderTemplate: '4K',
      },
      defaultRule,
    ];
    expect(
      selectNamingRule(rules, {
        mediaType: 'tv',
        path: '/x',
        filename: 'x.mkv',
        extension: 'mkv',
        resolution: '4K',
      })?.id,
    ).toBe('high');
    expect(
      selectNamingRule(rules, {
        mediaType: 'tv',
        path: '/x',
        filename: 'x.mkv',
        extension: 'mkv',
        resolution: '1080p',
      })?.id,
    ).toBe(defaultRule.id);
  });
});

describe('planner', () => {
  it('creates season folders and renames episode files', () => {
    const source = file(
      '/library/Blue Planet II/E01.mkv',
      'E01.mkv',
      '/library/Blue Planet II',
    );
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library/Blue Planet II'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: episodes[1],
          confidence: 1,
          reason: 'Test match',
          seriesName: 'Blue Planet II',
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate: '{tag} - {name}.{ext}',
          folderTemplate: 'Season {season:02}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });
    expect(plan.items[0].targetPath).toBe(
      '/library/Blue Planet II/Season 01/S01E02 - The Deep.mkv',
    );
    expect(plan.items[0].action).toBe('rename');
  });

  it('renders dimensions, air dates, multi-episode ends and aliases', () => {
    const source = file(
      '/library/Blue Planet II/Show.S02E03E04.1920x1080.mkv',
      'Show.S02E03E04.1920x1080.mkv',
      '/library/Blue Planet II',
    );
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/library/Blue Planet II'],
      files: [
        {
          ...source,
          parsed: parseMediaFilename(source.filename, source.relativePath),
          episode: {
            tag: 'S02E03',
            name: 'Coral Reefs',
            seasonNumber: 2,
            episodeNumber: 3,
            airDate: '2018-10-28',
          },
          confidence: 1,
          reason: 'Test match',
          seriesName: 'Blue Planet II',
        },
      ],
      rules: [
        createNamingRule('tv', {
          fileTemplate:
            '{episodeTag}-{episodeEnd}-{width}x{height}-{airDate:short}.{extension}',
          folderTemplate: 'Season {season}/{year}',
        }),
      ],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
    });
    expect(plan.items[0].targetPath).toBe(
      '/library/Blue Planet II/Season 2/2018/S02E03-4-1920x1080-2018-10.mkv',
    );
  });

  it('prefers TVDB, then Plex, then the filename for air dates', () => {
    const build = (
      episodeAirDate: string | undefined,
      plexAirDate: string | undefined,
      filename = 'Show.S02E03.mkv',
    ) => {
      const source = file(
        `/library/Show/${filename}`,
        filename,
        '/library/Show',
      );
      const plan = buildOrganizePlan({
        mediaType: 'tv',
        sourceRoots: ['/library/Show'],
        files: [
          {
            ...source,
            parsed: parseMediaFilename(filename, source.relativePath),
            episode: {
              tag: 'S02E03',
              name: 'Coral Reefs',
              seasonNumber: 2,
              episodeNumber: 3,
              ...(episodeAirDate ? { airDate: episodeAirDate } : {}),
            },
            ...(plexAirDate
              ? {
                  plex: {
                    metadataItemId: 1,
                    mediaItemId: 2,
                    mediaPartId: 3,
                    guid: 'plex://episode/1',
                    airDate: plexAirDate,
                    watchCount: 0,
                    watchStates: [],
                  },
                }
              : {}),
            confidence: 1,
            reason: 'Test match',
            seriesName: 'Show',
          },
        ],
        rules: [
          createNamingRule('tv', {
            fileTemplate: '{airDate}.{ext}',
            folderTemplate: '',
          }),
        ],
        confidenceThreshold: 0.6,
        renameMovieFolders: true,
        caseInsensitive: false,
        collisions: 'block',
        sidecarPolicy: 'rename',
      });
      return plan.items[0].targetPath;
    };

    expect(build('2018-10-28', '2019-01-05')).toBe(
      '/library/Show/2018-10-28.mkv',
    );
    expect(build(undefined, '2019-01-05')).toBe(
      '/library/Show/2019-01-05.mkv',
    );
    expect(build(undefined, undefined, 'Show.2017.04.15.mkv')).toBe(
      '/library/Show/2017-04-15.mkv',
    );
  });

  it('flags target collisions and low confidence', () => {
    const first = file('/library/Movies/A.mkv', 'A.mkv');
    const second = file('/library/Movies/B.mkv', 'B.mkv');
    const plan = buildOrganizePlan({
      mediaType: 'movies',
      sourceRoots: ['/library/Movies'],
      files: [
        {
          ...first,
          parsed: parseMediaFilename(first.filename),
          movie: { id: '1', slug: 'a', title: 'Same', year: 2008 },
          confidence: 1,
          reason: 'Test match',
        },
        {
          ...second,
          parsed: parseMediaFilename(second.filename),
          movie: { id: '1', slug: 'a', title: 'Same', year: 2008 },
          confidence: 0.2,
          reason: 'Weak match',
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
    expect(plan.items[0].targetPath).toBe(
      '/library/Movies/Same (2008)/Same (2008).mkv',
    );
    expect(plan.items[1].action).toBe('skip');
    expect(plan.warnings.join(' ')).toContain('confidence');
  });
});

describe('library organizer defaults', () => {
  it('migrates a v2 library and gives it organizer defaults', () => {
    const legacy = {
      ...emptyLibrary({ id: 'lib-1', name: 'Old' }),
      organize: undefined,
    } as unknown;
    const migrated = migrateAppConfig({
      schema_version: 2,
      lang: 'en',
      version_message: '',
      selected_library: 'lib-1',
      presets: [],
      libraries: [legacy],
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.config.schema_version).toBe(APP_CONFIG_SCHEMA_VERSION);
    expect(migrated.config.libraries[0].mediaType).toBe('movies');
    expect(
      migrated.config.libraries[0].organize?.namingRules.length,
    ).toBeGreaterThan(0);
  });

  it('resolves partial organize settings', () => {
    const settings = resolveOrganizeSettings(undefined, 'tv');
    expect(settings.namingRules[0].folderTemplate).toBe(
      '{show}/Season {season:02}',
    );
    expect(createOrganizeSettings('tv').namingRules[0].fileTemplate).toBe(
      '{tag} - {name}.{ext}',
    );
  });

  it('builds the expected TV tag helper', () => {
    expect(episodeTag(1, 2)).toBe('S01E02');
    expect(renderFileTemplate('{tag}.{ext}', { tag: 'S01E02', ext: 'mkv' })).toBe(
      'S01E02.mkv',
    );
  });
});
