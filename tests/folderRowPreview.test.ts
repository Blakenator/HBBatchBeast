import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_RELATIVE_PATH,
  folderRowPreview,
  sharedDestinationRows,
} from '../src/frontend/settings/folderRowPreview';

describe('folderRowPreview', () => {
  it('mirrors the sample path under the destination', () => {
    expect(
      folderRowPreview({ destination: '/media/converted/tv' }),
    ).toEqual({
      sample: EXAMPLE_RELATIVE_PATH,
      output:
        '/media/converted/tv/Show Name/Season 01/Episode 01.mp4',
    });
  });

  it('applies the row suffix and container', () => {
    expect(
      folderRowPreview({
        destination: '/media/converted/tv',
        suffix: '-720p',
        container: 'mkv',
      })?.output,
    ).toBe('/media/converted/tv/Show Name/Season 01/Episode 01-720p.mkv');
  });

  it('has no preview without a destination', () => {
    expect(folderRowPreview({ destination: '  ' })).toBeNull();
  });
});

describe('sharedDestinationRows', () => {
  it('groups rows by destination, ignoring trailing separators', () => {
    const shared = sharedDestinationRows([
      '/media/converted/library',
      '/media/converted/tv',
      '/media/converted/library/',
    ]);

    expect(shared.get(0)).toEqual([2]);
    expect(shared.get(2)).toEqual([0]);
    expect(shared.has(1)).toBe(false);
  });

  it('ignores empty destinations', () => {
    expect(sharedDestinationRows(['', '', '']).size).toBe(0);
  });

  it('compares Windows paths case-insensitively', () => {
    const shared = sharedDestinationRows(['D:\\Converted', 'd:\\converted\\']);

    expect(shared.get(0)).toEqual([1]);
    expect(shared.get(1)).toEqual([0]);
  });

  it('keeps POSIX paths case-sensitive', () => {
    expect(
      sharedDestinationRows(['/media/Converted', '/media/converted']).size,
    ).toBe(0);
  });
});
