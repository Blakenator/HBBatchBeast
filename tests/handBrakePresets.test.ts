import { describe, expect, it } from 'vitest';
import {
  findUnavailableHandBrakePresets,
  parseHandBrakePresetList,
} from '../src/backend/helpers';

const textOutput = `[13:42:06] Compile-time hardening features are enabled
[13:42:06] hb_init: starting libhb thread

General/
    Very Fast 2160p60 4K AV1
        AV1 video (up to 2160p60) and AAC stereo audio, in an MP4
        container.
    Very Fast 1080p30
        Small H.264 video (up to 1080p30) and AAC stereo audio, in
        an MP4 container.

Matroska/
    H.265 MKV 1080p30
        H.265 video (up to 1080p30) and AAC stereo audio, in a
        Matroska container.
`;

describe('parseHandBrakePresetList', () => {
  it('reads categories, names and wrapped descriptions from the text list', () => {
    expect(parseHandBrakePresetList(textOutput)).toEqual([
      {
        name: 'Very Fast 2160p60 4K AV1',
        category: 'General',
        description:
          'AV1 video (up to 2160p60) and AAC stereo audio, in an MP4 container.',
      },
      {
        name: 'Very Fast 1080p30',
        category: 'General',
        description:
          'Small H.264 video (up to 1080p30) and AAC stereo audio, in an MP4 container.',
      },
      {
        name: 'H.265 MKV 1080p30',
        category: 'Matroska',
        description:
          'H.265 video (up to 1080p30) and AAC stereo audio, in a Matroska container.',
      },
    ]);
  });

  describe('findUnavailableHandBrakePresets', () => {
    it('accepts installed names in both current and legacy forms', () => {
      expect(
        findUnavailableHandBrakePresets(
          'Very Fast 1080p30\n-Z "H.265 MKV 1080p30"',
          parseHandBrakePresetList(textOutput),
        ),
      ).toEqual([]);
    });

    it('reports stale values without duplicating repeated rows', () => {
      expect(
        findUnavailableHandBrakePresets(
          '0\nMissing Preset\nMissing Preset',
          parseHandBrakePresetList(textOutput),
        ),
      ).toEqual(['0', 'Missing Preset']);
    });
  });

  it('accepts a list that arrives on stderr with log noise', () => {
    const mixed = `
[13:42:06] nvenc: version 13.0 is available
Custom/
    My Phone Preset
        Created by me.
`;
    expect(parseHandBrakePresetList(mixed)).toEqual([
      {
        name: 'My Phone Preset',
        category: 'Custom',
        description: 'Created by me.',
      },
    ]);
  });

  it('falls back to the XML list printed by older HandBrake builds', () => {
    const xml = `<presets>
  <category name="General">
    <preset name="Fast &amp; Simple" />
  </category>
  <category name="Devices">
    <preset name="Apple 2005" />
  </category>
</presets>`;

    expect(parseHandBrakePresetList(xml)).toEqual([
      { name: 'Fast & Simple', category: 'General' },
      { name: 'Apple 2005', category: 'Devices' },
    ]);
  });

  it('ignores duplicate names and unrelated output', () => {
    expect(
      parseHandBrakePresetList(
        'General/\n    Fast 1080p30\nCustom/\n    Fast 1080p30\n',
      ),
    ).toEqual([{ name: 'Fast 1080p30', category: 'General' }]);
    expect(parseHandBrakePresetList('')).toEqual([]);
  });
});
