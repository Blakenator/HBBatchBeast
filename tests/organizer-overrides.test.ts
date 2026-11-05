import { describe, expect, it } from 'vitest';
import {
  applyPlanBestGuess,
  applyPlanOverride,
  approvePlanItems,
  applyPlanSkips,
  buildOrganizePlan,
  clearOverride,
  createNamingRule,
  createOrganizeSettings,
  mergeRescannedPlan,
  overrideFor,
  replanPlan,
  setOverride,
  setPlanFolderOnly,
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

  it('re-plans a multi-episode fix as a Plex-style range', () => {
    const plan = planFor(0.2);
    const first = {
      tag: 'S01E01',
      name: 'One Ocean',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const second = {
      tag: 'S01E02',
      name: 'The Deep',
      seasonNumber: 1,
      episodeNumber: 2,
    };
    const settings = createOrganizeSettings('tv');
    const next = applyPlanOverride(
      plan,
      plan.items[0].id,
      { episode: first, episodes: [first, second] },
      { settings, mediaType: 'tv' },
    );

    expect(next.items[0].episodes).toEqual([first, second]);
    expect(next.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01-E02 - One Ocean, The Deep.mkv',
    );

    const recalculated = replanPlan(next, { settings, mediaType: 'tv' });
    expect(recalculated.items[0].episodes).toEqual([first, second]);
    expect(recalculated.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01-E02 - One Ocean, The Deep.mkv',
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

describe('manual skips and plan recalculation', () => {
  const episode = {
    tag: 'S01E01',
    name: 'One Ocean',
    seasonNumber: 1,
    episodeNumber: 1,
  };

  function conflictedPlan() {
    const baseFile = {
      root: '/media/tv',
      filename: 'S01E01.mkv',
      extension: 'mkv',
      size: 0,
      parsed,
      confidence: 1,
      reason: 'Matched',
      episode,
      seriesName: 'Blue Planet II',
      showSubpath: 'Blue Planet II',
    };
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
          ...baseFile,
          path: '/media/tv/Blue Planet II/S01E01.mkv',
          relativePath: 'Blue Planet II/S01E01.mkv',
        },
        {
          ...baseFile,
          path: '/media/tv/Copy/S01E01.mkv',
          relativePath: 'Copy/S01E01.mkv',
          showSubpath: 'Copy',
        },
      ],
    });
  }

  it('manual skips release a conflicting target for the other row', () => {
    const plan = conflictedPlan();
    expect(plan.items.map((item) => item.action)).toEqual([
      'rename',
      'conflict',
    ]);

    const next = applyPlanSkips(plan, [plan.items[0].id], {
      settings: createOrganizeSettings('tv'),
      mediaType: 'tv',
    });

    expect(next.items[0]).toMatchObject({
      action: 'skip',
      manualSkip: true,
      reason: 'Skipped manually',
      sidecars: [],
    });
    expect(next.items[1].action).toBe('rename');
  });

  it('re-plans naming changes while keeping manual skips and sidecars', () => {
    const plan = buildOrganizePlan({
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
          sidecars: ['/media/tv/Blue Planet II/S01E01.en.srt'],
          parsed,
          confidence: 1,
          reason: 'Matched',
          episode,
          seriesName: 'Blue Planet II',
          showSubpath: 'Blue Planet II',
        },
      ],
    });
    const settings = createOrganizeSettings('tv');
    settings.namingRules = [
      createNamingRule('tv', {
        fileTemplate: '{tag}.{ext}',
        folderTemplate: '{show}/Season {season:02}',
      }),
    ];
    const skipped = applyPlanSkips(plan, [plan.items[0].id], {
      settings,
      mediaType: 'tv',
    });
    const replanned = replanPlan(skipped, { settings, mediaType: 'tv' });

    expect(replanned.items[0]).toMatchObject({
      action: 'skip',
      manualSkip: true,
      reason: 'Skipped manually',
      targetPath: '/media/tv/Blue Planet II/Season 01/S01E01.mkv',
    });
    expect(replanned.items[0].sidecars).toEqual([
      {
        sourcePath: '/media/tv/Blue Planet II/S01E01.en.srt',
        targetPath: '/media/tv/Blue Planet II/Season 01/S01E01.en.srt',
      },
    ]);
  });
});

describe('best guess promotion', () => {
  const episode = {
    tag: 'S01E01',
    name: 'One Ocean',
    seasonNumber: 1,
    episodeNumber: 1,
  };

  function lowConfidencePlan(
    confidence = 0.2,
    rules = [createNamingRule('tv')],
  ) {
    return buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv'],
      rules,
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
          reason: 'Matched',
          episode,
          seriesName: 'Blue Planet II',
          showSubpath: 'Blue Planet II',
        },
      ],
    });
  }

  it('promotes a low-confidence row to a rename when asked', () => {
    const plan = lowConfidencePlan();
    expect(plan.items[0].action).toBe('skip');
    expect(plan.items[0].reason).toBe('Matched');

    const next = applyPlanBestGuess(plan, [plan.items[0].id], {
      settings: createOrganizeSettings('tv'),
      mediaType: 'tv',
    });

    expect(next.items[0].action).toBe('rename');
    expect(next.items[0].reason).toBe('Best guess (20% confidence)');
    expect(next.items[0].manualSkip).toBeUndefined();
    expect(next.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );
  });

  it('clears a manual skip and keeps the matched episode', () => {
    const plan = lowConfidencePlan(1);
    expect(plan.items[0].action).toBe('rename');

    const settings = createOrganizeSettings('tv');
    const skipped = applyPlanSkips(plan, [plan.items[0].id], {
      settings,
      mediaType: 'tv',
    });
    expect(skipped.items[0]).toMatchObject({
      action: 'skip',
      manualSkip: true,
      reason: 'Skipped manually',
    });

    const next = applyPlanBestGuess(skipped, [skipped.items[0].id], {
      settings,
      mediaType: 'tv',
    });

    expect(next.items[0].action).toBe('rename');
    expect(next.items[0].manualSkip).toBeUndefined();
    expect(next.items[0].episode).toEqual(episode);
    expect(next.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );
  });

  it('leaves rows that are already named in place and untouched rows alone', () => {
    const rules = [
      createNamingRule('tv', {
        fileTemplate: '{tag}.{ext}',
        folderTemplate: '{show}/Season {season:02}',
      }),
    ];
    const alreadyNamed = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv'],
      rules,
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [
        {
          path: '/media/tv/Blue Planet II/Season 01/S01E01.mkv',
          root: '/media/tv',
          relativePath: 'Blue Planet II/Season 01/S01E01.mkv',
          filename: 'S01E01.mkv',
          extension: 'mkv',
          size: 0,
          parsed,
          confidence: 0.2,
          reason: 'No matching TVDB episode',
          episode,
          seriesName: 'Blue Planet II',
          showSubpath: 'Blue Planet II',
        },
        {
          path: '/media/tv/Blue Planet II/S01E02.mkv',
          root: '/media/tv',
          relativePath: 'Blue Planet II/S01E02.mkv',
          filename: 'S01E02.mkv',
          extension: 'mkv',
          size: 0,
          parsed: { ...parsed, episodeNumber: 2 },
          confidence: 0.2,
          reason: 'No matching TVDB episode',
          seriesName: 'Blue Planet II',
          showSubpath: 'Blue Planet II',
        },
      ],
    });
    expect(alreadyNamed.items[0].action).toBe('skip');

    const settings = createOrganizeSettings('tv');
    settings.namingRules = rules;
    const next = applyPlanBestGuess(
      alreadyNamed,
      [alreadyNamed.items[0].id],
      { settings, mediaType: 'tv', caseInsensitive: false },
    );

    // Already at its target, so it stays a no-op rather than renaming onto itself.
    expect(next.items[0].action).toBe('skip');
    expect(next.items[0]).toEqual(alreadyNamed.items[0]);
    expect(next.items[1]).toEqual(alreadyNamed.items[1]);
  });
});

describe('partial folder rescan', () => {
  const episode = {
    tag: 'S01E01',
    name: 'One Ocean',
    seasonNumber: 1,
    episodeNumber: 1,
  };

  function planFor(paths: string[], root = '/media/tv') {
    return buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: [root],
      rules: [createNamingRule('tv')],
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: paths.map((filePath) => ({
        path: filePath,
        root,
        relativePath: filePath.slice(root.length + 1),
        filename: filePath.slice(filePath.lastIndexOf('/') + 1),
        extension: 'mkv',
        size: 0,
        parsed,
        confidence: 1,
        reason: 'Matched',
        episode,
        seriesName: 'Blue Planet II',
        showSubpath: 'Blue Planet II',
      })),
    });
  }

  const seasonOne = '/media/tv/Blue Planet II/Season 01';
  const first = `${seasonOne}/S01E01.mkv`;
  const second = `${seasonOne}/S01E02.mkv`;
  const third = `${seasonOne}/S01E03.mkv`;
  const otherSeason = '/media/tv/Blue Planet II/Season 02/S02E01.mkv';

  it('replaces the rows under the folder and appends new files', () => {
    const plan = planFor([first, second, otherSeason]);
    const skipped = applyPlanSkips(plan, [first], {
      settings: createOrganizeSettings('tv'),
      mediaType: 'tv',
    });
    const rescanned = planFor([first, third]);

    const merged = mergeRescannedPlan(skipped, rescanned, [seasonOne], {
      settings: createOrganizeSettings('tv'),
      mediaType: 'tv',
    });

    expect(merged.items.map((item) => item.id)).toEqual([
      first,
      otherSeason,
      third,
    ]);
    // The explicit skip survives the rescan of its folder.
    expect(merged.items[0]).toMatchObject({
      action: 'skip',
      manualSkip: true,
      reason: 'Skipped manually',
    });
    // The file that disappeared from disk is gone from the review.
    expect(merged.items.some((item) => item.id === second)).toBe(false);
    expect(merged.items[1]).toEqual(skipped.items[2]);
  });

  it('matches folders case-insensitively when the platform needs it', () => {
    const plan = planFor(['/Media/Show/Season 01/S01E01.mkv'], '/Media/Show');
    const rescanned = planFor(
      ['/media/show/season 01/S01E01.mkv'],
      '/media/show',
    );

    const merged = mergeRescannedPlan(
      plan,
      rescanned,
      ['/Media/Show/Season 01'],
      { settings: createOrganizeSettings('tv'), mediaType: 'tv', caseInsensitive: true },
    );

    expect(merged.items.map((item) => item.id)).toEqual([
      '/media/show/season 01/S01E01.mkv',
    ]);
  });

  it('leaves the plan untouched without folders', () => {
    const plan = planFor([first]);
    const merged = mergeRescannedPlan(plan, planFor([third]), [], {
      settings: createOrganizeSettings('tv'),
      mediaType: 'tv',
    });
    expect(merged).toBe(plan);
  });
});

describe('row approvals', () => {
  const episode = {
    tag: 'S01E01',
    name: 'One Ocean',
    seasonNumber: 1,
    episodeNumber: 1,
  };

  function planWithSettings() {
    const settings = createOrganizeSettings('tv');
    settings.namingRules = [
      createNamingRule('tv', {
        folderTemplate: '{show}/Season {season:02}',
      }),
    ];
    const base = {
      root: '/media/tv',
      extension: 'mkv',
      size: 0,
      parsed,
      reason: 'Fuzzy match',
      episode,
    };
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv'],
      rules: settings.namingRules,
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [
        {
          ...base,
          path: '/media/tv/Blue Planet II/S01E01.mkv',
          relativePath: 'Blue Planet II/S01E01.mkv',
          filename: 'S01E01.mkv',
          confidence: 0.4,
          seriesName: 'Blue Planet II',
          showSubpath: 'Blue Planet II',
        },
        {
          ...base,
          path: '/media/tv/Frozen Planet/S01E01.mkv',
          relativePath: 'Frozen Planet/S01E01.mkv',
          filename: 'S01E01.mkv',
          confidence: 1,
          seriesName: 'Frozen Planet',
          showSubpath: 'Frozen Planet',
        },
      ],
    });
    return { plan, settings };
  }

  it('keeps an approved row as a rename across later replans', () => {
    const { plan, settings } = planWithSettings();
    expect(plan.items.map((item) => item.action)).toEqual(['skip', 'rename']);

    const approved = approvePlanItems(plan, [plan.items[0].id], {
      settings,
      mediaType: 'tv',
    });
    expect(approved.items[0]).toMatchObject({
      action: 'rename',
      approved: true,
    });
    expect(approved.items[1].action).toBe('rename');

    const skipped = applyPlanSkips(approved, [plan.items[1].id], {
      settings,
      mediaType: 'tv',
    });
    expect(skipped.items[0]).toMatchObject({
      action: 'rename',
      approved: true,
    });
    expect(skipped.items[1]).toMatchObject({
      action: 'skip',
      manualSkip: true,
    });
  });

  it('keeps a best-guess promotion across later replans', () => {
    const { plan, settings } = planWithSettings();
    const promoted = applyPlanBestGuess(plan, [plan.items[0].id], {
      settings,
      mediaType: 'tv',
    });
    expect(promoted.items[0]).toMatchObject({
      action: 'rename',
      approved: true,
    });

    const skipped = applyPlanSkips(promoted, [plan.items[1].id], {
      settings,
      mediaType: 'tv',
    });
    expect(skipped.items[0].action).toBe('rename');
    expect(skipped.items[1]).toMatchObject({
      action: 'skip',
      manualSkip: true,
    });
  });

  it('re-includes a manually skipped row when it is approved', () => {
    const { plan, settings } = planWithSettings();
    const skipped = applyPlanSkips(plan, [plan.items[1].id], {
      settings,
      mediaType: 'tv',
    });
    expect(skipped.items[1].manualSkip).toBe(true);

    const approved = approvePlanItems(skipped, [plan.items[1].id], {
      settings,
      mediaType: 'tv',
    });
    expect(approved.items[1]).toMatchObject({
      action: 'rename',
      approved: true,
    });
    expect(approved.items[1].manualSkip).toBeUndefined();
  });

  it('leaves unapproved rows as they were', () => {
    const { plan, settings } = planWithSettings();
    const approved = approvePlanItems(plan, [plan.items[1].id], {
      settings,
      mediaType: 'tv',
    });
    expect(approved.items[0]).toEqual(plan.items[0]);
    expect(approved.items[1]).not.toEqual(plan.items[1]);
  });
});

describe('folder-only rows', () => {
  function folderPlan() {
    const settings = createOrganizeSettings('tv');
    settings.namingRules = [
      createNamingRule('tv', {
        fileTemplate: '{tag} - {name}.{ext}',
        folderTemplate: '{show}/Season {season:02}',
      }),
    ];
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv'],
      rules: settings.namingRules,
      confidenceThreshold: 0.6,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [
        {
          path: '/media/tv/Blue Planet II/Season 1/One Ocean.mkv',
          root: '/media/tv',
          relativePath: 'Blue Planet II/Season 1/One Ocean.mkv',
          filename: 'One Ocean.mkv',
          extension: 'mkv',
          size: 0,
          parsed,
          confidence: 1,
          reason: 'Matched',
          episode: {
            tag: 'S01E01',
            name: 'One Ocean',
            seasonNumber: 1,
            episodeNumber: 1,
          },
          seriesName: 'Blue Planet II',
          showSubpath: 'Blue Planet II',
        },
      ],
    });
    return { plan, settings };
  }

  it('keeps the source file name while applying the folder', () => {
    const { plan, settings } = folderPlan();
    expect(plan.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );

    const folderOnly = setPlanFolderOnly(plan, [plan.items[0].id], true, {
      settings,
      mediaType: 'tv',
    });

    expect(folderOnly.items[0]).toMatchObject({
      action: 'rename',
      folderOnly: true,
      renameFolderOnly: true,
      targetPath: '/media/tv/Blue Planet II/Season 01/One Ocean.mkv',
    });
  });

  it('restores the template file name when the flag is cleared', () => {
    const { plan, settings } = folderPlan();
    const folderOnly = setPlanFolderOnly(plan, [plan.items[0].id], true, {
      settings,
      mediaType: 'tv',
    });
    const restored = setPlanFolderOnly(
      folderOnly,
      [plan.items[0].id],
      false,
      { settings, mediaType: 'tv' },
    );

    expect(restored.items[0]).toMatchObject({
      action: 'rename',
      targetPath: '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    });
    expect(restored.items[0].renameFolderOnly).toBeUndefined();
    expect(restored.items[0].folderOnly).toBeFalsy();
  });

  it('keeps the folder-only decision across replans', () => {
    const { plan, settings } = folderPlan();
    const folderOnly = setPlanFolderOnly(plan, [plan.items[0].id], true, {
      settings,
      mediaType: 'tv',
    });

    const replanned = applyPlanSkips(folderOnly, [], {
      settings,
      mediaType: 'tv',
    });
    expect(replanned.items[0]).toMatchObject({
      action: 'rename',
      folderOnly: true,
      renameFolderOnly: true,
      targetPath: '/media/tv/Blue Planet II/Season 01/One Ocean.mkv',
    });
  });
});
