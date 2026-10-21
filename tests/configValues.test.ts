import { describe, expect, it } from 'vitest';
import {
  countConfiguredRows,
  normalizeFileType,
  normalizePresetName,
  parseCommandPair,
  parseMappedRows,
  parsePropertyFilters,
  parseTokenList,
  serializeCommandPair,
  serializeMappedRows,
  serializePropertyFilters,
  serializeTokenList,
} from '../src/common';

describe('mapped rows', () => {
  it('keeps interior blanks so paired rows stay aligned', () => {
    expect(parseMappedRows('/movies\n\n/tv')).toEqual(['/movies', '', '/tv']);
    expect(serializeMappedRows(['/out/movies', '', '/out/tv'])).toBe(
      '/out/movies\n\n/out/tv',
    );
  });

  it('drops trailing blanks and preserves the stored format', () => {
    expect(parseMappedRows('/movies\n\n')).toEqual(['/movies']);
    expect(serializeMappedRows(['/movies', '', ''])).toBe('/movies');
    expect(serializeMappedRows(['', '/movies'])).toBe('\n/movies');
  });

  it('handles empty values', () => {
    expect(parseMappedRows(undefined)).toEqual([]);
    expect(serializeMappedRows([])).toBe('');
    expect(serializeMappedRows(['', ''])).toBe('');
  });

  it('counts only configured rows', () => {
    expect(countConfiguredRows('/movies\n\n/tv')).toBe(2);
  });
});

describe('preset names', () => {
  it('accepts displayed names and legacy `-Z` arguments', () => {
    expect(normalizePresetName('-Z "H.264 NVENC 1080p"')).toBe(
      'H.264 NVENC 1080p',
    );
    expect(normalizePresetName('Fast 1080p30')).toBe('Fast 1080p30');
  });
});

describe('token lists', () => {
  it('accepts commas and newlines', () => {
    expect(parseTokenList('mp4, mkv\nmov')).toEqual(['mp4', 'mkv', 'mov']);
    expect(parseTokenList(' , ')).toEqual([]);
  });

  it('serialises as a comma list', () => {
    expect(serializeTokenList(['mp4', ' mkv ', ''])).toBe('mp4,mkv');
  });

  it('normalises extensions', () => {
    expect(normalizeFileType('.MP4')).toBe('mp4');
  });
});

describe('property filters', () => {
  it('parses the worker format and the legacy help format', () => {
    expect(
      parsePropertyFilters("codec_name: 'h264',width=1920, profile : \"main\""),
    ).toEqual([
      { key: 'codec_name', value: 'h264' },
      { key: 'width', value: '1920' },
      { key: 'profile', value: 'main' },
    ]);
  });

  it('serialises in the format the worker compares against', () => {
    expect(
      serializePropertyFilters([
        { key: 'codec_name', value: 'h264' },
        { key: '', value: 'ignored' },
        { key: 'width', value: '1920' },
      ]),
    ).toBe("codec_name: 'h264',width: '1920'");
  });
});

describe('FFmpeg command pairs', () => {
  it('splits on the first comma', () => {
    expect(parseCommandPair('-ss 00:00:10,-c:v libx264 -crf 20')).toEqual({
      input: '-ss 00:00:10',
      output: '-c:v libx264 -crf 20',
    });
  });

  it('round-trips and tolerates a missing output half', () => {
    expect(serializeCommandPair({ input: '-ss 10', output: '-c:v x264' })).toBe(
      '-ss 10,-c:v x264',
    );
    expect(serializeCommandPair({ input: '-ss 10', output: '' })).toBe('-ss 10,');
    expect(serializeCommandPair({ input: '', output: '' })).toBe('');
    expect(parseCommandPair('-ss 10')).toEqual({ input: '-ss 10', output: '' });
  });
});
