import { describe, expect, it } from 'vitest';
import {
  MULTI_EPISODE_NAME_THRESHOLD,
  detectEpisodeRunFromName,
  episodesForStart,
  groupItemsForSequence,
  parseMediaFilename,
  planItemSeason,
  planItemStartEpisode,
  rebaseSequenceBase,
  sequenceStarts,
  type OrganizePlanItem,
  type ParsedMediaName,
  type TvdbEpisode,
} from '../src/common/organizer';

const episodes: TvdbEpisode[] = [
  { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
  { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
  { tag: 'S01E03', name: 'Coral Reefs', seasonNumber: 1, episodeNumber: 3 },
  { tag: 'S01E04', name: 'Big Blue', seasonNumber: 1, episodeNumber: 4 },
  { tag: 'S02E01', name: 'New Shores', seasonNumber: 2, episodeNumber: 1 },
  { tag: 'S02E02', name: 'Open Water', seasonNumber: 2, episodeNumber: 2 },
];

const SERIES = 'Blue Planet II';

function detect(filename: string, options: Parameters<typeof detectEpisodeRunFromName>[2] = {}) {
  return detectEpisodeRunFromName(
    parseMediaFilename(filename),
    episodes,
    { seriesName: SERIES, ...options },
  );
}

function item(
  overrides: Partial<OrganizePlanItem> & Pick<OrganizePlanItem, 'id'>,
): OrganizePlanItem {
  return {
    mediaType: 'tv',
    sourcePath: `/media/tv/${overrides.id}`,
    sourceRoot: '/media/tv',
    sourceRelativePath: overrides.id,
    targetPath: `/media/tv/${overrides.id}`,
    relativeTarget: overrides.id,
    action: 'rename',
    sidecars: [],
    ...overrides,
  } as OrganizePlanItem;
}

function parsedWith(season: number, episode: number): ParsedMediaName {
  return {
    title: SERIES,
    cleanTitle: SERIES.toLowerCase(),
    seasonNumber: season,
    episodeNumber: episode,
  };
}

describe('detectEpisodeRunFromName', () => {
  it('detects two joined titles from the tagged start', () => {
    const run = detect('Blue.Planet.II.S01E01.One.Ocean.and.The.Deep.mkv');
    expect(run?.tag).toBe('S01E01-E02');
    expect(run?.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2]);
    expect(run?.score).toBeGreaterThan(MULTI_EPISODE_NAME_THRESHOLD);
    expect(run?.score).toBeGreaterThan(run?.singleScore ?? 1);
  });

  it('detects a three-episode run', () => {
    const run = detect(
      'Blue.Planet.II.S01E01.One.Ocean.The.Deep.and.Coral.Reefs.mkv',
    );
    expect(run?.tag).toBe('S01E01-E03');
  });

  it('does not stretch a single-episode title', () => {
    expect(detect('Blue.Planet.II.S01E01.One.Ocean.mkv')).toBeUndefined();
  });

  it('does not extend when the second title is missing', () => {
    expect(
      detect('Blue.Planet.II.S01E02.The.Deep.1080p.mkv'),
    ).toBeUndefined();
  });

  it('extends forward only from an anchored episode', () => {
    const run = detect(
      'Blue.Planet.II.S01E02.The.Deep.and.Coral.Reefs.mkv',
      { anchorEpisode: episodes[1] },
    );
    expect(run?.tag).toBe('S01E02-E03');
  });

  it('lets name evidence pick a different start than a wrong tag', () => {
    const run = detect(
      'Blue.Planet.II.S01E02.One.Ocean.and.The.Deep.mkv',
      { preferredEpisodeNumber: 2 },
    );
    expect(run?.tag).toBe('S01E01-E02');
  });

  it('detects from the filename when there is no tag but a season is known', () => {
    const parsed = parseMediaFilename(
      'Blue.Planet.II.One.Ocean.and.The.Deep.1080p.mkv',
    );
    const run = detectEpisodeRunFromName(
      { ...parsed, seasonNumber: 1 },
      episodes,
      { seriesName: SERIES },
    );
    expect(run?.tag).toBe('S01E01-E02');
  });

  it('returns undefined without a season or title text', () => {
    expect(
      detectEpisodeRunFromName(
        { title: '', cleanTitle: '' },
        episodes,
        { seriesName: SERIES },
      ),
    ).toBeUndefined();
    expect(
      detectEpisodeRunFromName(
        parseMediaFilename('Blue.Planet.II.One.Ocean.and.The.Deep.mkv'),
        episodes,
        { seriesName: SERIES },
      ),
    ).toBeUndefined();
  });

  it('stops at the end of the season', () => {
    const run = detect(
      'Blue.Planet.II.S01E03.Coral.Reefs.and.Big.Blue.mkv',
      { anchorEpisode: episodes[2] },
    );
    expect(run?.tag).toBe('S01E03-E04');
    const pastEnd = detect(
      'Blue.Planet.II.S01E04.Big.Blue.and.Something.Else.mkv',
      { anchorEpisode: episodes[3] },
    );
    expect(pastEnd).toBeUndefined();
  });
});

describe('episodesForStart', () => {
  it('returns a consecutive run within the season', () => {
    const result = episodesForStart(episodes, 1, 2, 2);
    expect(result.problem).toBeUndefined();
    expect(result.episodes?.map((episode) => episode.tag)).toEqual([
      'S01E02',
      'S01E03',
    ]);
  });

  it('rejects a range past the last episode', () => {
    const result = episodesForStart(episodes, 1, 4, 2);
    expect(result.problem?.kind).toBe('past-end');
    expect(result.problem?.message).toContain('last episode S01E04');
  });

  it('rejects a missing episode in the season', () => {
    const gapped = episodes.filter(
      (episode) => !(episode.seasonNumber === 1 && episode.episodeNumber === 3),
    );
    const result = episodesForStart(gapped, 1, 2, 2);
    expect(result.problem?.kind).toBe('missing-episode');
    expect(result.problem?.message).toContain('S01E03');
  });

  it('reports an unknown season', () => {
    expect(episodesForStart(episodes, undefined, 1, 2).problem?.kind).toBe(
      'unknown-season',
    );
    expect(episodesForStart(episodes, 3, 1, 2).problem?.kind).toBe(
      'unknown-season',
    );
  });

  it('handles specials in Season 00', () => {
    const specials: TvdbEpisode[] = [
      { tag: 'S00E01', name: 'Making Of', seasonNumber: 0, episodeNumber: 1 },
      { tag: 'S00E02', name: 'Behind the Scenes', seasonNumber: 0, episodeNumber: 2 },
    ];
    const result = episodesForStart(specials, 0, 1, 2);
    expect(result.episodes?.map((episode) => episode.tag)).toEqual([
      'S00E01',
      'S00E02',
    ]);
  });

  it('rejects an invalid count', () => {
    expect(episodesForStart(episodes, 1, 1, 0).problem?.kind).toBe(
      'invalid-count',
    );
  });
});

describe('sequential grouping', () => {
  it('groups by show and season and orders naturally', () => {
    const grouping = groupItemsForSequence([
      item({
        id: 'Planet Earth/Season 01/B.mkv',
        seriesName: 'Planet Earth',
        parsed: parsedWith(1, 2),
      }),
      item({
        id: 'Blue Planet II/Season 02/B.mkv',
        seriesName: 'Blue Planet II',
        parsed: parsedWith(2, 1),
      }),
      item({
        id: 'Blue Planet II/Season 01/Episode 10.mkv',
        seriesName: 'Blue Planet II',
        parsed: {
          title: SERIES,
          cleanTitle: SERIES.toLowerCase(),
          seasonNumber: 1,
        },
      }),
      item({
        id: 'Blue Planet II/Season 01/Episode 2.mkv',
        seriesName: 'Blue Planet II',
        parsed: {
          title: SERIES,
          cleanTitle: SERIES.toLowerCase(),
          seasonNumber: 1,
        },
      }),
    ]);

    expect(grouping.ungrouped).toHaveLength(0);
    expect(grouping.groups.map((group) => group.key)).toEqual([
      'blue planet ii\u00001',
      'blue planet ii\u00002',
      'planet earth\u00001',
    ]);
    const seasonOne = grouping.groups.find(
      (group) => group.seriesName === 'Blue Planet II' && group.seasonNumber === 1,
    );
    expect(seasonOne?.items.map((entry) => entry.id)).toEqual([
      'Blue Planet II/Season 01/Episode 2.mkv',
      'Blue Planet II/Season 01/Episode 10.mkv',
    ]);
  });

  it('uses natural order for Windows-style relative paths', () => {
    const grouping = groupItemsForSequence([
      item({
        id: 'C:\\TV\\Show\\Episode 10.mkv',
        sourceRelativePath: 'Show\\Episode 10.mkv',
        seriesName: 'Show',
        parsed: parsedWith(1, 1),
      }),
      item({
        id: 'C:\\TV\\Show\\Episode 2.mkv',
        sourceRelativePath: 'Show\\Episode 2.mkv',
        seriesName: 'Show',
        parsed: parsedWith(1, 1),
      }),
    ]);
    expect(grouping.groups[0].items.map((entry) => entry.id)).toEqual([
      'C:\\TV\\Show\\Episode 2.mkv',
      'C:\\TV\\Show\\Episode 10.mkv',
    ]);
  });

  it('keeps rows without a show or season out of the sequence', () => {
    const grouping = groupItemsForSequence([
      item({ id: 'Unknown/a.mkv' }),
      item({ id: 'Unknown/b.mkv', seriesName: 'Show' }),
    ]);
    expect(grouping.groups).toHaveLength(0);
    expect(grouping.ungrouped).toHaveLength(2);
  });

  it('falls back to the matched episodes for season and start', () => {
    const entry = item({
      id: 'show/S01E05-E06.mkv',
      seriesName: 'Show',
      episodes: [
        { tag: 'S01E05', name: 'A', seasonNumber: 1, episodeNumber: 5 },
        { tag: 'S01E06', name: 'B', seasonNumber: 1, episodeNumber: 6 },
      ],
    });
    expect(planItemSeason(entry)).toBe(1);
    expect(planItemStartEpisode(entry)).toBe(5);
  });
});

describe('sequential numbering', () => {
  const grouping = groupItemsForSequence([
    item({
      id: 'Blue Planet II/Season 01/e1.mkv',
      seriesName: 'Blue Planet II',
      parsed: parsedWith(1, 1),
    }),
    item({
      id: 'Blue Planet II/Season 01/e2.mkv',
      seriesName: 'Blue Planet II',
      parsed: parsedWith(1, 3),
    }),
    item({
      id: 'Planet Earth/Season 01/e1.mkv',
      seriesName: 'Planet Earth',
      parsed: parsedWith(1, 1),
    }),
  ]);

  it('assigns each group from E01 and advances by the count', () => {
    const starts = sequenceStarts(grouping.groups, 2);
    expect(starts.get('Blue Planet II/Season 01/e1.mkv')).toBe(1);
    expect(starts.get('Blue Planet II/Season 01/e2.mkv')).toBe(3);
    expect(starts.get('Planet Earth/Season 01/e1.mkv')).toBe(1);
  });

  it('honours an edited group base', () => {
    const starts = sequenceStarts(grouping.groups, 2, {
      'blue planet ii\u00001': 5,
    });
    expect(starts.get('Blue Planet II/Season 01/e1.mkv')).toBe(5);
    expect(starts.get('Blue Planet II/Season 01/e2.mkv')).toBe(7);
    expect(starts.get('Planet Earth/Season 01/e1.mkv')).toBe(1);
  });

  it('cascades a rebase to later rows', () => {
    expect(rebaseSequenceBase(2, 0, 6)).toBe(6);
    expect(rebaseSequenceBase(2, 1, 8)).toBe(6);
    expect(rebaseSequenceBase(2, 3, 4)).toBe(1);
  });
});
