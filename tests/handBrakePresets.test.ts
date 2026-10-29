import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  findUnavailableHandBrakePresets,
  handBrakeExecutableCandidates,
  parseHandBrakePresetList,
  resolveHandBrakeExecutable,
  userPresetFiles,
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


describe('handBrakeExecutableCandidates', () => {
  it('covers Windows Program Files and local installs', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    };
    const candidates = handBrakeExecutableCandidates({
      platform: 'win32',
      env,
      home: 'C:\\Users\\me',
    });

    expect(candidates).toContain('HandBrakeCLI.exe');
    expect(candidates).toContain(
      path.join('C:\\Program Files', 'HandBrake', 'HandBrakeCLI.exe'),
    );
    expect(candidates).toContain(
      path.join('C:\\Program Files (x86)', 'HandBrake', 'HandBrakeCLI.exe'),
    );
    expect(candidates).toContain(
      path.join(
        'C:\\Users\\me\\AppData\\Local',
        'Programs',
        'HandBrake',
        'HandBrakeCLI.exe',
      ),
    );
  });

  it('covers the macOS app bundle and Homebrew locations', () => {
    const candidates = handBrakeExecutableCandidates({
      platform: 'darwin',
      home: '/Users/me',
    });

    expect(candidates).toContain('HandBrakeCLI');
    expect(candidates).toContain('/opt/homebrew/bin/HandBrakeCLI');
    expect(candidates).toContain('/usr/local/bin/HandBrakeCLI');
    expect(candidates).toContain(
      '/Applications/HandBrake.app/Contents/MacOS/HandBrakeCLI',
    );
    expect(candidates).toContain(
      path.join(
        '/Users/me',
        'Applications',
        'HandBrake.app',
        'Contents',
        'MacOS',
        'HandBrakeCLI',
      ),
    );
  });

  it('covers Linux system and Snap locations', () => {
    const candidates = handBrakeExecutableCandidates({ platform: 'linux' });

    expect(candidates).toContain('HandBrakeCLI');
    expect(candidates).toContain('/usr/bin/HandBrakeCLI');
    expect(candidates).toContain('/usr/local/bin/HandBrakeCLI');
    expect(candidates).toContain('/snap/bin/handbrake-cli');
  });
});

describe('resolveHandBrakeExecutable', () => {
  it('returns the first existing absolute candidate', () => {
    const expected =
      '/Applications/HandBrake.app/Contents/MacOS/HandBrakeCLI';
    const resolved = resolveHandBrakeExecutable({
      platform: 'darwin',
      home: '/Users/me',
      exists: (filePath) => filePath === expected,
    });

    expect(resolved).toBe(expected);
  });

  it('falls back to the bare platform command', () => {
    expect(
      resolveHandBrakeExecutable({
        platform: 'win32',
        env: {},
        home: 'C:\\Users\\me',
        exists: () => false,
      }),
    ).toBe('HandBrakeCLI.exe');
    expect(
      resolveHandBrakeExecutable({
        platform: 'linux',
        home: '/home/me',
        exists: () => false,
      }),
    ).toBe('HandBrakeCLI');
  });
});

describe('userPresetFiles', () => {
  it('finds the Windows roaming preset file', () => {
    const expected = path.join(
      'C:\\Users\\me\\AppData\\Roaming',
      'HandBrake',
      'presets.json',
    );
    expect(
      userPresetFiles({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
        home: 'C:\\Users\\me',
        exists: (filePath) => filePath === expected,
      }),
    ).toEqual([expected]);
  });

  it('finds the macOS application-support preset file', () => {
    const expected = path.join(
      '/Users/me',
      'Library',
      'Application Support',
      'HandBrake',
      'presets.json',
    );
    expect(
      userPresetFiles({
        platform: 'darwin',
        home: '/Users/me',
        exists: (filePath) => filePath === expected,
      }),
    ).toEqual([expected]);
  });

  it('finds native, Flatpak and Snap presets on Linux', () => {
    const native = path.join('/home/me', '.config', 'ghb', 'presets.json');
    const flatpak = path.join(
      '/home/me',
      '.var',
      'app',
      'fr.handbrake.ghb',
      'config',
      'ghb',
      'presets.json',
    );
    const snap = path.join(
      '/home/me',
      'snap',
      'handbrake',
      'current',
      '.config',
      'ghb',
      'presets.json',
    );
    const existing = new Set([native, flatpak, snap]);

    expect(
      userPresetFiles({
        platform: 'linux',
        env: {},
        home: '/home/me',
        exists: (filePath) => existing.has(filePath),
      }),
    ).toEqual([native, flatpak, snap]);
  });
});
