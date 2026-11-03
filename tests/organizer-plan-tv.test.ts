import { describe, expect, it } from 'vitest';
import {
  buildOrganizePlan,
  createNamingRule,
  organizerIsPathInside,
  type OrganizeSourceFile,
  type ParsedMediaName,
} from '../src/common/organizer';

const parsed: ParsedMediaName = {
  title: 'One Ocean',
  cleanTitle: 'one ocean',
  seasonNumber: 1,
  episodeNumber: 1,
};

function file(
  root: string,
  relativePath: string,
  showSubpath: string,
  seriesName: string,
): OrganizeSourceFile & {
  parsed: ParsedMediaName;
  confidence: number;
  reason: string;
  episode: { tag: string; name: string; seasonNumber: number; episodeNumber: number };
  seriesName: string;
  showSubpath: string;
} {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const name = relativePath.split('/').pop() ?? relativePath;
  return {
    path: [root.replace(/[\\/]+$/, ''), ...relativePath.split('/')].join(separator),
    root,
    relativePath: relativePath.split('/').join(separator),
    filename: name,
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
    seriesName,
    showSubpath,
  };
}

const rules = [
  createNamingRule('tv', {
    fileTemplate: '{tag} - {name}.{ext}',
    folderTemplate: '{show}/Season {season:02}',
  }),
];

describe('multi-show TV plans', () => {
  it('names the show folder for nested shows', () => {
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv'],
      rules,
      confidenceThreshold: 0,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [
        file(
          '/media/tv',
          'Blue Planet II/Season 01/S01E01.mkv',
          'Blue Planet II',
          'Blue Planet II',
        ),
      ],
    });

    expect(plan.items[0].targetPath).toBe(
      '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );
    expect(plan.items[0].relativeTarget).toBe(
      'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    );
    expect(plan.items[0].showFolder).toBe('Blue Planet II');
    expect(plan.items[0].sourceRelativePath).toBe(
      'Blue Planet II/Season 01/S01E01.mkv',
    );
  });

  it('drops the show segment when the root is the show folder', () => {
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv/Planet Earth'],
      rules,
      confidenceThreshold: 0,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [file('/media/tv/Planet Earth', 'S01E01.mkv', '', 'Planet Earth')],
    });

    // No nested "Planet Earth/Planet Earth" folder for single-show libraries.
    expect(plan.items[0].targetPath).toBe(
      '/media/tv/Planet Earth/Season 01/S01E01 - One Ocean.mkv',
    );
  });

  it('keeps the Windows separator style and handles drive roots', () => {
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['C:\\Media\\TV'],
      rules,
      confidenceThreshold: 0,
      renameMovieFolders: true,
      caseInsensitive: true,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [
        file(
          'C:\\Media\\TV',
          'Blue Planet II/Season 01/S01E01.mkv',
          'Blue Planet II',
          'Blue Planet II',
        ),
      ],
    });

    expect(plan.items[0].targetPath).toBe(
      'C:\\Media\\TV\\Blue Planet II\\Season 01\\S01E01 - One Ocean.mkv',
    );
  });

  it('flags a target that collides with another show folder', () => {
    const first = file(
      '/media/tv',
      'Blue Planet II/Season 01/S01E01.mkv',
      'Blue Planet II',
      'Blue Planet II',
    );
    const second = {
      ...first,
      path: '/media/tv/Copy/Season 01/S01E01.mkv',
      relativePath: 'Copy/Season 01/S01E01.mkv',
      showSubpath: 'Copy',
    };
    const plan = buildOrganizePlan({
      mediaType: 'tv',
      sourceRoots: ['/media/tv'],
      rules,
      confidenceThreshold: 0,
      renameMovieFolders: true,
      caseInsensitive: false,
      collisions: 'block',
      sidecarPolicy: 'rename',
      files: [first, second],
    });

    // The second file is renamed into the same show folder, so the first
    // target is taken and the second is reported as a conflict.
    expect(plan.items.map((item) => item.action)).toContain('conflict');
  });
});

describe('show path containment', () => {
  it('recognises Windows and UNC paths', () => {
    expect(organizerIsPathInside('C:\\TV\\Show\\ep.mkv', 'c:\\tv')).toBe(true);
    expect(
      organizerIsPathInside('\\\\server\\share\\Show\\ep.mkv', '\\\\server\\share'),
    ).toBe(true);
    expect(organizerIsPathInside('/media/tv2/ep.mkv', '/media/tv')).toBe(false);
  });
});
