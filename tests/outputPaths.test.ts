import { describe, expect, it } from 'vitest';
import {
  joinOutputPath,
  outputContainerExtension,
  outputRelativePath,
} from '../src/common/outputPaths';

describe('outputRelativePath', () => {
  it('keeps nested folders and swaps the extension', () => {
    expect(
      outputRelativePath('Show A/Season 01/Episode 01.mkv', '', '.mp4'),
    ).toBe('Show A/Season 01/Episode 01.mp4');
  });

  it('appends the suffix before the container', () => {
    expect(
      outputRelativePath('Show A/Season 01/Episode 01.mkv', '-1080p', '.mkv'),
    ).toBe('Show A/Season 01/Episode 01-1080p.mkv');
  });

  it('keeps subtitle sidecars untouched', () => {
    expect(outputRelativePath('Show A/Episode 01.srt', '-x', '.mp4')).toBe(
      'Show A/Episode 01.srt',
    );
    expect(outputRelativePath('Show A/Episode 01.SRT', '-x', '.mp4')).toBe(
      'Show A/Episode 01.srt',
    );
  });

  it('handles files without an extension and dotfiles', () => {
    expect(outputRelativePath('extra/feature', '', '.mkv')).toBe(
      'extra/feature.mkv',
    );
    expect(outputRelativePath('extra/.hidden', '', '.mkv')).toBe(
      'extra/.hidden.mkv',
    );
  });

  it('handles Windows separators', () => {
    expect(
      outputRelativePath('Show A\\Season 01\\Episode 01.mkv', '', '.mp4'),
    ).toBe('Show A\\Season 01\\Episode 01.mp4');
  });
});

describe('outputContainerExtension', () => {
  it('defaults to .mp4 like the queue builder', () => {
    expect(outputContainerExtension()).toBe('.mp4');
    expect(outputContainerExtension('   ')).toBe('.mp4');
  });

  it('normalizes the leading dot without changing case', () => {
    expect(outputContainerExtension('mkv')).toBe('.mkv');
    expect(outputContainerExtension(' .MKV ')).toBe('.MKV');
  });
});

describe('joinOutputPath', () => {
  it('joins POSIX paths and trims trailing separators', () => {
    expect(
      joinOutputPath('/media/converted/tv/', 'Show A/Season 01/Episode 01.mp4'),
    ).toBe('/media/converted/tv/Show A/Season 01/Episode 01.mp4');
  });

  it('keeps the backslash style of a Windows root', () => {
    expect(
      joinOutputPath('D:\\Converted\\', 'Show A/Season 01/Episode 01.mp4'),
    ).toBe('D:\\Converted\\Show A\\Season 01\\Episode 01.mp4');
  });

  it('keeps a UNC share intact', () => {
    expect(joinOutputPath('\\\\nas\\media', 'Show A/Episode 01.mp4')).toBe(
      '\\\\nas\\media\\Show A\\Episode 01.mp4',
    );
  });

  it('tolerates leading separators in the relative path', () => {
    expect(joinOutputPath('/media/tv', '/Show A/Episode 01.mp4')).toBe(
      '/media/tv/Show A/Episode 01.mp4',
    );
  });
});
