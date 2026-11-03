import { describe, expect, it } from 'vitest';
import {
  expandHomePath,
  isPathInside,
  isSamePath,
  isWindowsStylePath,
  normalizePathForComparison,
  pathBasename,
  pathComparisonKey,
  pathDirname,
} from '../src/common/pathUtils';

describe('normalizePathForComparison', () => {
  it('unifies separators and drops trailing ones', () => {
    expect(normalizePathForComparison('C:\\Media\\Movies\\')).toBe(
      'C:/Media/Movies',
    );
    expect(normalizePathForComparison('/media/movies///')).toBe(
      '/media/movies',
    );
  });

  it('preserves filesystem roots', () => {
    expect(normalizePathForComparison('/')).toBe('/');
    expect(normalizePathForComparison('C:\\')).toBe('C:');
    expect(normalizePathForComparison('\\\\nas\\share\\')).toBe(
      '//nas/share',
    );
    expect(normalizePathForComparison('')).toBe('');
  });
});

describe('isWindowsStylePath', () => {
  it('recognises drive letters and UNC shares', () => {
    expect(isWindowsStylePath('C:\\Media')).toBe(true);
    expect(isWindowsStylePath('C:/Media')).toBe(true);
    expect(isWindowsStylePath('\\\\nas\\share')).toBe(true);
    expect(isWindowsStylePath('/media/movies')).toBe(false);
    expect(isWindowsStylePath('relative/movies')).toBe(false);
  });
});

describe('isSamePath', () => {
  it('compares POSIX paths case-sensitively', () => {
    expect(isSamePath('/media/Movies', '/media/Movies')).toBe(true);
    expect(isSamePath('/media/Movies', '/media/movies')).toBe(false);
  });

  it('compares Windows paths case-insensitively across separator styles', () => {
    expect(isSamePath('C:\\Media\\Movies', 'c:/media/movies')).toBe(true);
    expect(isSamePath('\\\\NAS\\Share', '//nas/share')).toBe(true);
  });

  it('never treats empty paths as equal', () => {
    expect(isSamePath('', '')).toBe(false);
  });
});

describe('pathComparisonKey', () => {
  it('lower-cases only Windows-style paths', () => {
    expect(pathComparisonKey('C:\\Media')).toBe('c:/media');
    expect(pathComparisonKey('/Media')).toBe('/Media');
  });
});

describe('isPathInside', () => {
  it('matches the path itself and real children', () => {
    expect(isPathInside('/media/movies', '/media/movies')).toBe(true);
    expect(isPathInside('/media/movies/sub', '/media/movies')).toBe(true);
    expect(isPathInside('/media/movies/', '/media/movies')).toBe(true);
  });

  it('does not match siblings that share a prefix', () => {
    expect(isPathInside('/media/movies2', '/media/movies')).toBe(false);
    expect(isPathInside('C:\\Media\\Movies2', 'C:\\Media\\Movies')).toBe(false);
  });

  it('handles mixed separators and Windows case-insensitivity', () => {
    expect(isPathInside('C:/Media/Movies/Sub', 'C:\\Media\\Movies')).toBe(true);
    expect(isPathInside('c:\\media\\movies\\sub', 'C:/Media/Movies')).toBe(true);
    expect(isPathInside('\\\\NAS\\Share\\Movies', '\\\\nas\\share')).toBe(
      true,
    );
  });

  it('treats filesystem roots as parents', () => {
    expect(isPathInside('/media/movies', '/')).toBe(true);
    expect(isPathInside('C:/Media', 'C:\\')).toBe(true);
  });

  it('requires a non-empty parent', () => {
    expect(isPathInside('anything', '')).toBe(false);
    expect(isPathInside('', '/media')).toBe(false);
  });
});

describe('pathBasename', () => {
  it('accepts both separators', () => {
    expect(pathBasename('/media/movies/Show.mkv')).toBe('Show.mkv');
    expect(pathBasename('C:\\Media\\Movies\\Show.mkv')).toBe('Show.mkv');
    expect(pathBasename('/media/movies/')).toBe('movies');
    expect(pathBasename('')).toBe('');
  });
});

describe('pathDirname', () => {
  it('handles POSIX paths and roots', () => {
    expect(pathDirname('/media/movies/Show.mkv')).toBe('/media/movies');
    expect(pathDirname('/Show.mkv')).toBe('/');
    expect(pathDirname('relative/Show.mkv')).toBe('relative');
    expect(pathDirname('Show.mkv')).toBe('');
    expect(pathDirname('')).toBe('');
  });

  it('preserves Windows separator style and drive roots', () => {
    expect(pathDirname('C:\\Media\\Movies\\Show.mkv')).toBe(
      'C:\\Media\\Movies',
    );
    expect(pathDirname('C:/Media/Movies/Show.mkv')).toBe('C:/Media/Movies');
    expect(pathDirname('C:\\Show.mkv')).toBe('C:\\');
    expect(pathDirname('\\\\nas\\share\\Show.mkv')).toBe('\\\\nas\\share');
  });
});

describe('expandHomePath', () => {
  it('expands ~ and ~/ with POSIX separators', () => {
    expect(expandHomePath('~', '/home/me')).toBe('/home/me');
    expect(expandHomePath('~/Videos', '/home/me')).toBe('/home/me/Videos');
    expect(expandHomePath('  ~/Videos  ', '/home/me')).toBe('/home/me/Videos');
  });

  it('uses the home separator style on Windows', () => {
    expect(expandHomePath('~/Videos/clip.mp4', 'C:\\Users\\me')).toBe(
      'C:\\Users\\me\\Videos\\clip.mp4',
    );
    expect(expandHomePath('~\\Videos\\clip.mp4', 'C:\\Users\\me')).toBe(
      'C:\\Users\\me\\Videos\\clip.mp4',
    );
  });

  it('leaves other paths unchanged', () => {
    expect(expandHomePath('/media/movies', '/home/me')).toBe('/media/movies');
    expect(expandHomePath('', '/home/me')).toBe('');
  });
});
