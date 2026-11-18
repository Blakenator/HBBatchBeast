import { describe, expect, it } from 'vitest';
import {
  blackBatchEtaSeconds,
  blackDividerCuts,
  blackDividerSeconds,
  estimateSplitBoundaries,
  formatSplitTimecode,
  nearestBlackDivider,
  nearestSplitCandidates,
  pruneSplitPlans,
  segmentsForEpisodes,
  splitTargetsForItem,
  validateSplitPlan,
  type OrganizeSplitPlan,
} from '../src/common/organizer/split';
import { createOrganizeSettings } from '../src/common/organizer/settings';
import type {
  OrganizePlanItem,
  TvdbEpisode,
} from '../src/common/organizer/types';

const episode = (episodeNumber: number, seasonNumber = 1): TvdbEpisode => ({
  tag: `S${String(seasonNumber).padStart(2, '0')}E${String(
    episodeNumber,
  ).padStart(2, '0')}`,
  name: `Episode ${episodeNumber}`,
  seasonNumber,
  episodeNumber,
});

function tvItem(overrides: Partial<OrganizePlanItem> = {}): OrganizePlanItem {
  const source = '/media/tv/Blue Planet II/Blue.Planet.II.S01E01-E02.mkv';
  return {
    id: source,
    mediaType: 'tv',
    sourcePath: source,
    sourceRoot: '/media/tv',
    sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
    targetPath: source,
    relativeTarget: 'Blue Planet II/Blue.Planet.II.S01E01-E02.mkv',
    action: 'skip',
    confidence: 1,
    reason: 'Already named',
    sidecars: [],
    parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
    showFolder: 'Blue Planet II',
    showSubpath: 'Blue Planet II',
    seriesName: 'Blue Planet II',
    episode: episode(1),
    episodes: [episode(1), episode(2)],
    ...overrides,
  };
}

function splitPlan(
  overrides: Partial<OrganizeSplitPlan> = {},
): OrganizeSplitPlan {
  return {
    itemId: tvItem().id,
    sourcePath: tvItem().sourcePath,
    fileSize: 1000,
    fileDurationSeconds: 3600,
    episodeDurationsSeconds: [1700, 1700],
    estimate: { method: 'tvdb', slackSeconds: 200 },
    cutMode: 'copy',
    originalPolicy: 'backup',
    sidecarPolicy: 'leave',
    segments: segmentsForEpisodes([episode(1), episode(2)], [0, 1800, 3600]),
    updatedAt: 1,
    ...overrides,
  };
}

describe('estimateSplitBoundaries', () => {
  it('distributes the leftover runtime evenly across the cuts', () => {
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: 3660,
      episodeDurationsSeconds: [1800, 1800],
    });
    expect(estimate.method).toBe('tvdb');
    expect(estimate.slackSeconds).toBe(60);
    // 1800 + 30 (half of the 60 s leftover) at the single interior cut.
    expect(estimate.boundaries[1]).toBe(1830);
    expect(estimate.boundaries[2]).toBe(3660);
  });

  it('spreads the leftover across every boundary for three episodes', () => {
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: 3630,
      episodeDurationsSeconds: [1200, 1200, 1200],
    });
    expect(estimate.boundaries).toEqual([0, 1210, 2420, 3630]);
  });

  it('scales proportionally when the runtimes exceed the file', () => {
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: 3000,
      episodeDurationsSeconds: [1800, 1800],
    });
    expect(estimate.method).toBe('tvdb');
    expect(estimate.boundaries).toEqual([0, 1500, 3000]);
    expect(estimate.note).toMatch(/scaled proportionally/i);
  });

  it('shares the remaining time with episodes that have no runtime', () => {
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: 3600,
      episodeDurationsSeconds: [1800, undefined],
    });
    expect(estimate.method).toBe('mixed');
    expect(estimate.boundaries[1]).toBe(1800);
    expect(estimate.boundaries[2]).toBe(3600);
  });

  it('falls back to an even split with no runtimes', () => {
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: 3600,
      episodeDurationsSeconds: [undefined, undefined, undefined],
    });
    expect(estimate.method).toBe('equal');
    expect(estimate.boundaries).toEqual([0, 1200, 2400, 3600]);
  });

  it('ignores invalid runtimes and never inverts boundaries', () => {
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: 100,
      episodeDurationsSeconds: [0, -5, Number.NaN],
    });
    expect(estimate.method).toBe('equal');
    for (let index = 1; index < estimate.boundaries.length; index += 1) {
      expect(estimate.boundaries[index]).toBeGreaterThan(
        estimate.boundaries[index - 1],
      );
    }
  });
});

describe('validateSplitPlan', () => {
  it('accepts a well formed split', () => {
    expect(validateSplitPlan(splitPlan())).toEqual([]);
  });

  it('reports overlap, short segments and a missing episode', () => {
    const problems = validateSplitPlan(
      splitPlan({
        segments: [
          { index: 0, startSeconds: 0, endSeconds: 50, episode: episode(1) },
          {
            index: 1,
            startSeconds: 40,
            endSeconds: 50,
            episode: undefined,
          },
        ],
      }),
      { fileDurationSeconds: 60 },
    );
    expect(problems.join('\n')).toMatch(
      /overlaps|shorter|no episode|end of the file/i,
    );
  });

  it('rejects duplicate episodes and out-of-range cuts', () => {
    const problems = validateSplitPlan(
      splitPlan({
        segments: [
          {
            index: 0,
            startSeconds: -10,
            endSeconds: 1800,
            episode: episode(1),
          },
          {
            index: 1,
            startSeconds: 1800,
            endSeconds: 4000,
            episode: episode(1),
          },
        ],
      }),
      { fileDurationSeconds: 3600 },
    );
    expect(problems.join('\n')).toMatch(/before the file/i);
    expect(problems.join('\n')).toMatch(/after the file|end of the file/i);
    expect(problems.join('\n')).toMatch(/more than one segment/i);
  });
});

describe('splitTargetsForItem', () => {
  it('renders one target per segment with the single-episode template', () => {
    const item = tvItem();
    const settings = createOrganizeSettings('tv');
    const { targets, conflicts } = splitTargetsForItem(
      item,
      splitPlan().segments,
      { settings, mediaType: 'tv', caseInsensitive: false },
    );
    expect(conflicts).toEqual([]);
    expect(targets[0]?.replace(/\\/g, '/')).toContain(
      'Blue Planet II/Season 01/S01E01 - Episode 1.mkv',
    );
    expect(targets[1]?.replace(/\\/g, '/')).toContain(
      'Blue Planet II/Season 01/S01E02 - Episode 2.mkv',
    );
  });

  it('suffixes collisions on POSIX and Windows paths', () => {
    const item = tvItem();
    const settings = {
      ...createOrganizeSettings('tv'),
      collisions: 'suffix' as const,
    };
    const existing = [
      '/media/tv/Blue Planet II/Season 01/S01E01 - Episode 1.mkv',
      'C:\\Media\\TV\\Blue Planet II\\Season 01\\S01E01 - Episode 1.mkv',
    ];
    const { targets } = splitTargetsForItem(item, splitPlan().segments, {
      settings,
      mediaType: 'tv',
      caseInsensitive: false,
      existingPaths: existing,
    });
    expect(targets[0]).toMatch(/S01E01 - Episode 1 \(2\)\.mkv$/);
  });

  it('reports a blocking collision under the block policy', () => {
    const item = tvItem();
    const settings = createOrganizeSettings('tv');
    const { conflicts } = splitTargetsForItem(item, splitPlan().segments, {
      settings,
      mediaType: 'tv',
      caseInsensitive: false,
      existingPaths: [
        '/media/tv/Blue Planet II/Season 01/S01E01 - Episode 1.mkv',
      ],
    });
    expect(conflicts.join('\n')).toMatch(/already exists/i);
  });
});

describe('pruneSplitPlans', () => {
  it('keeps matching splits and drops rows that disappeared or changed', () => {
    const item = tvItem();
    const other = tvItem({
      id: '/media/tv/Other/S01E01-E02.mkv',
      sourcePath: '/media/tv/Other/S01E01-E02.mkv',
      sourceRelativePath: 'Other/S01E01-E02.mkv',
      episodes: [episode(3), episode(4)],
    });
    const kept = { ...splitPlan(), itemId: item.id };
    const changed = {
      ...splitPlan(),
      itemId: other.id,
      sourcePath: other.sourcePath,
    };
    const missing = {
      ...splitPlan(),
      itemId: '/media/tv/Gone/S01E01-E02.mkv',
      sourcePath: '/media/tv/Gone/S01E01-E02.mkv',
    };
    const result = pruneSplitPlans([kept, changed, missing], [item, other]);
    expect(result.splits.map((split) => split.itemId)).toEqual([item.id]);
    expect(result.dropped).toHaveLength(2);
  });
});

describe('formatSplitTimecode', () => {
  it('formats minutes and hours', () => {
    expect(formatSplitTimecode(65)).toBe('1:05');
    expect(formatSplitTimecode(3725)).toBe('1:02:05');
    expect(formatSplitTimecode(3725.4, true)).toBe('1:02:05.4');
  });
});

describe('nearestSplitCandidates', () => {
  it('returns the five keyframes closest to the cut', () => {
    expect(nearestSplitCandidates([5, 1, 50, 12, 9, 30, 3], 10)).toEqual([
      9, 12, 5, 3, 1,
    ]);
  });

  it('drops the current keyframe and duplicates, and honors a smaller limit', () => {
    expect(nearestSplitCandidates([10, 10.002, 14, 6, 18], 10, 2)).toEqual([
      10.002, 6,
    ]);
  });
});

describe('black frame dividers', () => {
  const intervals = [
    { startSeconds: 10, endSeconds: 12 },
    { startSeconds: 50, endSeconds: 50.2 },
    { startSeconds: 100, endSeconds: 104 },
  ];

  it('cuts at the middle of a black run', () => {
    expect(blackDividerSeconds(intervals[0])).toBe(11);
  });

  it('finds the nearest divider inside the tolerance', () => {
    expect(nearestBlackDivider(intervals, 13, 5)).toBe(11);
    expect(nearestBlackDivider(intervals, 20, 5)).toBeUndefined();
  });

  it('returns one cut per run and ignores short flashes', () => {
    expect(blackDividerCuts(intervals, 0.5)).toEqual([11, 102]);
  });

  it('estimates the batch ETA from the work already done', () => {
    // Nothing decoded yet, so there is no rate to extrapolate.
    expect(blackBatchEtaSeconds(3600, 0, 10)).toBeUndefined();
    // Half the duration in 60 s leaves another 60 s.
    expect(blackBatchEtaSeconds(3600, 1800, 60)).toBe(60);
    // Two hours of video decoded in 30 s leaves 3× that.
    expect(blackBatchEtaSeconds(7200, 1800, 30)).toBe(90);
    expect(blackBatchEtaSeconds(3600, 3600, 60)).toBe(0);
  });
});

describe('segmentsForEpisodes', () => {
  it('keeps an unassigned segment slot', () => {
    const segments = segmentsForEpisodes(
      [episode(1), undefined],
      [0, 1800, 3600],
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].episode?.tag).toBe('S01E01');
    expect(segments[1].episode).toBeUndefined();
  });
});
