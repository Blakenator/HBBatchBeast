import { describe, expect, it } from 'vitest';
import {
  applyPlanOverride,
  buildOrganizePlan,
  clearOverride,
  createNamingRule,
  createOrganizeSettings,
  overrideFor,
  setOverride,
  type ParsedMediaName,
} from '../src/common/organizer';

const parsed: ParsedMediaName = {
  title: 'One Ocean',
  cleanTitle: 'one ocean',
  seasonNumber: 1,
  episodeNumber: 1,
};

function planFor(confidence: number) {
  return buildOrganizePlan({
    mediaType: 'tv',
    sourceRoots: ['/media/tv'],
    rules: [
      createNamingRule('tv', {
        folderTemplate: '{show}/Season {season:02}',
      }),
    ],
    confidenceThreshold: 0.6,
    renameMovieFolders: true,
    caseInsensitive: false,
    collisions: 'block',
    sidecarPolicy: 'rename',
    files: [
      {
        path: '/media/tv/Blue Planet II/S01E01.mkv',
        root: '/media/tv',
        relativePath: 'Blue Planet II/S01E01.mkv',
        filename: 'S01E01.mkv',
        extension: 'mkv',
        size: 0,
        parsed,
        confidence,
        reason: confidence >= 0.6 ? 'Matched' : 'No matching TVDB episode',
        seriesName: 'Blue Planet II',
        showSubpath: 'Blue Planet II',
      },
    ],
  });
}

describe('manual match overrides', () => {
  it('stores and clears overrides by file comparison key', () => {
    let settings = createOrganizeSettings('tv');
    const filePath = '/media/tv/Blue Planet II/S01E01.mkv';
    settings = setOverride(
      settings,
      filePath,
      { series: { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' } },
      true,
    );
    expect(overrideFor(settings, filePath, true)?.series?.slug).toBe(
      'blue-planet-ii',
    );
    expect(
      overrideFor(settings, '/MEDIA/TV/Blue Planet II/S01E01.mkv', true)
        ?.series?.slug,
    ).toBe('blue-planet-ii');
    settings = clearOverride(settings, filePath, true);
    expect(overrideFor(settings, filePath, true)).toBeUndefined();
  });

  it('re-plans a skipped row into a rename after a manual match', () => {
    const plan = planFor(0.2);
    expect(plan.items[0].action).toBe('skip');

    const settings = createOrganizeSettings('tv');
    const next = applyPlanOverride(plan, plan.items[0].id, {
      episode: {
        tag: 'S01E01',
        name: 'One Ocean',
        seasonNumber: 1,
        episodeNumber: 1,
      },
    }, { settings, mediaType: 'tv' });

    expect(next.items[0].action).toBe('rename');
    expect(next.items[0].confidence).toBe(1);
    expect(next.items[0].reason).toBe('Manual match');
    expect(next.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );
  });

  it('keeps the row id stable and leaves other rows untouched', () => {
    const plan = planFor(1);
    const withTwo = {
      ...plan,
      items: [
        ...plan.items,
        {
          ...plan.items[0],
          id: '/media/tv/Other/S01E01.mkv',
          sourcePath: '/media/tv/Other/S01E01.mkv',
        },
      ],
    };
    const next = applyPlanOverride(
      withTwo,
      plan.items[0].id,
      {
        episode: {
          tag: 'S01E01',
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: 1,
        },
      },
      { settings: createOrganizeSettings('tv'), mediaType: 'tv' },
    );

    expect(next.items[0].id).toBe(plan.items[0].id);
    expect(next.items[1]).toEqual(withTwo.items[1]);
  });
});
