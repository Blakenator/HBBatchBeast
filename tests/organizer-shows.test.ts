import { describe, expect, it } from 'vitest';
import {
  createOrganizeSettings,
  findShowMapping,
  guessSeriesQuery,
  normalizeSubpath,
  pickBestSeries,
  removeShowMapping,
  resolveShowMapping,
  showFolderKey,
  upsertShowMapping,
  type TvdbSeriesRef,
} from '../src/common/organizer';

const bluePlanet: TvdbSeriesRef = {
  id: '1',
  slug: 'blue-planet-ii',
  name: 'Blue Planet II',
  year: 2017,
};
const planetEarth: TvdbSeriesRef = {
  id: '2',
  slug: 'planet-earth',
  name: 'Planet Earth',
  year: 2006,
};

function settingsWithShows() {
  let settings = createOrganizeSettings('tv');
  settings = upsertShowMapping(settings, {
    id: 'show-nested',
    folderId: 'folder-1',
    subpath: 'Blue Planet II',
    series: bluePlanet,
  });
  settings = upsertShowMapping(settings, {
    id: 'show-nested-2',
    folderId: 'folder-1',
    subpath: 'Planet Earth',
    series: planetEarth,
  });
  return settings;
}

describe('show folder paths', () => {
  it('normalises POSIX and Windows separators', () => {
    expect(normalizeSubpath('/Show//Season 1/')).toBe('Show/Season 1');
    expect(normalizeSubpath('Show\\Season 1')).toBe('Show/Season 1');
    expect(normalizeSubpath('./Show/')).toBe('Show');
    expect(normalizeSubpath('')).toBe('');
  });

  it('builds a stable key per folder and subpath', () => {
    expect(showFolderKey('folder-1', '/Show/')).toBe('folder-1:Show');
    expect(showFolderKey('folder-1', '')).toBe('folder-1:');
  });
});

describe('show mappings', () => {
  it('adds, replaces and removes mappings per show folder', () => {
    let settings = settingsWithShows();
    expect(settings.tvdb?.shows).toHaveLength(2);

    settings = upsertShowMapping(settings, {
      id: 'show-root',
      folderId: 'folder-1',
      subpath: 'blue planet ii',
      series: bluePlanet,
    });
    expect(settings.tvdb?.shows).toHaveLength(2);
    expect(
      findShowMapping(settings, 'folder-1', 'Blue Planet II')?.series.name,
    ).toBe('Blue Planet II');

    settings = removeShowMapping(settings, 'folder-1', 'Blue Planet II');
    expect(settings.tvdb?.shows).toHaveLength(1);
    expect(findShowMapping(settings, 'folder-1', 'Blue Planet II')).toBeUndefined();
  });

  it('resolves the longest matching subpath', () => {
    const settings = settingsWithShows();
    expect(
      resolveShowMapping(
        settings,
        'folder-1',
        'Blue Planet II/Season 01/S01E01.mkv',
      )?.series.slug,
    ).toBe('blue-planet-ii');
    expect(
      resolveShowMapping(settings, 'folder-1', 'Planet Earth/S01E01.mkv')?.series
        .slug,
    ).toBe('planet-earth');
    expect(
      resolveShowMapping(settings, 'folder-1', 'Other Show/S01E01.mkv'),
    ).toBeUndefined();
    expect(
      resolveShowMapping(settings, 'folder-2', 'Anything/S01E01.mkv'),
    ).toBeUndefined();
  });

  it('honours case sensitivity options', () => {
    const settings = settingsWithShows();
    expect(
      resolveShowMapping(
        settings,
        'folder-1',
        'blue planet ii/Season 01/S01E01.mkv',
        { caseInsensitive: false },
      ),
    ).toBeUndefined();
    expect(
      resolveShowMapping(
        settings,
        'folder-1',
        'blue planet ii/Season 01/S01E01.mkv',
        { caseInsensitive: true },
      )?.series.slug,
    ).toBe('blue-planet-ii');
  });
});

describe('whole-folder show', () => {
  it('lets a root mapping win over nested show folders', () => {
    let settings = settingsWithShows();
    settings = upsertShowMapping(settings, {
      id: 'show-root',
      folderId: 'folder-1',
      subpath: '',
      series: planetEarth,
    });

    expect(
      resolveShowMapping(settings, 'folder-1', 'Blue Planet II/S01E01.mkv')
        ?.series.slug,
    ).toBe('planet-earth');
    expect(
      resolveShowMapping(settings, 'folder-1', 'Planet Earth/S01E01.mkv')
        ?.series.slug,
    ).toBe('planet-earth');
  });
});

describe('series name matching', () => {
  it('turns messy folder names into a query and year', () => {
    expect(guessSeriesQuery('Blue.Planet.II.2017.1080p.BluRay.x264-GRP')).toEqual({
      query: 'Blue Planet II',
      year: 2017,
    });
    expect(guessSeriesQuery('The Office (US)')).toEqual({
      query: 'The Office US',
    });
    expect(guessSeriesQuery('Planet Earth {tvdb-12345}')).toEqual({
      query: 'Planet Earth',
    });
    expect(guessSeriesQuery('[Group] Some.Show.2019')).toEqual({
      query: 'Some Show',
      year: 2019,
    });
  });

  it('picks the closest series and rejects weak matches', () => {
    const match = pickBestSeries([bluePlanet, planetEarth], {
      query: 'Blue Planet 2',
      year: 2017,
    });
    expect(match?.series.slug).toBe('blue-planet-ii');
    expect(match?.score).toBeGreaterThan(0.8);

    expect(
      pickBestSeries([planetEarth], { query: 'Completely Different Show' }),
    ).toBeUndefined();
  });

  it('penalises a mismatched year', () => {
    expect(
      pickBestSeries([planetEarth], { query: 'Planet Earth', year: 2024 }),
    ).toBeUndefined();
    expect(
      pickBestSeries([planetEarth], { query: 'Planet Earth', year: 2007 })?.series
        .slug,
    ).toBe('planet-earth');
  });
});
