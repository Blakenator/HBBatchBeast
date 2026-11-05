import { describe, expect, it } from 'vitest';
import {
  applyNameReplacements,
  createOrganizeSettings,
  parseMediaFilenameWithReplacements,
  resolveOrganizeSettings,
} from '../src/common/organizer';

describe('organize name replacements', () => {
  it('applies literal, case-insensitive replacements in order', () => {
    const replacements = [
      { id: '1', find: '_', replace: ' ' },
      { id: '2', find: 'doctor who', replace: 'DW' },
    ];
    expect(applyNameReplacements('Doctor_Who_S01E01', replacements)).toBe(
      'DW S01E01',
    );
  });

  it('applies replacements to parsed titles after separators are normalized', () => {
    const parsed = parseMediaFilenameWithReplacements(
      'Doctor.Who.S01E01.mkv',
      'Doctor.Who.S01E01.mkv',
      [{ id: '1', find: 'Doctor Who', replace: 'DW' }],
    );
    expect(parsed.title).toBe('DW');
    expect(parsed.seasonNumber).toBe(1);
    expect(parsed.episodeNumber).toBe(1);
  });

  it('normalizes stored replacement lists and drops empty search strings', () => {
    const settings = resolveOrganizeSettings(
      {
        nameReplacements: [
          { id: 'keep', find: '_', replace: ' ' },
          { id: 'drop', find: '', replace: 'x' },
          { find: 'Doctor Who', replace: 'DW' },
        ],
      },
      'tv',
    );
    expect(settings.nameReplacements).toEqual([
      { id: 'keep', find: '_', replace: ' ' },
      { id: 'drop', find: '', replace: 'x' },
      { id: 'organize-replace-2', find: 'Doctor Who', replace: 'DW' },
    ]);
    expect(createOrganizeSettings('tv').nameReplacements).toEqual([]);
  });
});
