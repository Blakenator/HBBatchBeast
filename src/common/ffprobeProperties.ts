/**
 * Discoverable catalog of scalar, top-level `ffprobe -show_streams` fields.
 *
 * The evaluator compares `stream[key]` directly, so nested objects such as
 * `tags` or `disposition` cannot be matched and are intentionally absent.
 * These lists only power suggestions; any top-level key can still be typed.
 */

export type FfprobePropertyGroup = 'Common' | 'Video' | 'Audio' | 'Other';

export interface FfprobePropertyDefinition {
  key: string;
  group: FfprobePropertyGroup;
  numeric?: boolean;
  values: string[];
}

export const FFPROBE_PROPERTY_GROUPS: FfprobePropertyGroup[] = [
  'Common',
  'Video',
  'Audio',
  'Other',
];

export const FFPROBE_PROPERTIES: FfprobePropertyDefinition[] = [
  {
    key: 'codec_name',
    group: 'Common',
    values: [
      'h264',
      'hevc',
      'av1',
      'vp9',
      'mpeg4',
      'mpeg2video',
      'prores',
      'dnxhd',
      'aac',
      'ac3',
      'eac3',
      'dts',
      'truehd',
      'flac',
      'opus',
      'vorbis',
      'mp3',
      'pcm_s16le',
      'subrip',
      'ass',
    ],
  },
  {
    key: 'codec_type',
    group: 'Common',
    values: ['video', 'audio', 'subtitle', 'attachment'],
  },
  {
    key: 'codec_long_name',
    group: 'Common',
    values: [],
  },
  {
    key: 'profile',
    group: 'Common',
    values: [
      'Constrained Baseline',
      'Baseline',
      'Main',
      'High',
      'Main 10',
      'Main Still Picture',
    ],
  },
  {
    key: 'bit_rate',
    group: 'Common',
    numeric: true,
    values: [
      '64000',
      '128000',
      '192000',
      '256000',
      '320000',
      '1000000',
      '5000000',
      '10000000',
    ],
  },
  {
    key: 'width',
    group: 'Video',
    numeric: true,
    values: ['640', '720', '1280', '1920', '2560', '3840', '4096'],
  },
  {
    key: 'height',
    group: 'Video',
    numeric: true,
    values: ['480', '576', '720', '1080', '1440', '2160'],
  },
  {
    key: 'coded_width',
    group: 'Video',
    numeric: true,
    values: ['640', '720', '1280', '1920', '2560', '3840', '4096'],
  },
  {
    key: 'coded_height',
    group: 'Video',
    numeric: true,
    values: ['480', '576', '720', '1080', '1440', '2160'],
  },
  {
    key: 'pix_fmt',
    group: 'Video',
    values: [
      'yuv420p',
      'yuv422p',
      'yuv444p',
      'yuv420p10le',
      'yuv422p10le',
      'yuv444p10le',
      'p010le',
      'nv12',
      'rgb24',
      'bgr24',
    ],
  },
  {
    key: 'r_frame_rate',
    group: 'Video',
    values: [
      '23.976',
      '24000/1001',
      '24',
      '25',
      '29.97',
      '30000/1001',
      '30',
      '50',
      '59.94',
      '60000/1001',
      '60',
      '120',
    ],
  },
  {
    key: 'avg_frame_rate',
    group: 'Video',
    values: [
      '23.976',
      '24000/1001',
      '24',
      '25',
      '29.97',
      '30000/1001',
      '30',
      '50',
      '59.94',
      '60000/1001',
      '60',
      '120',
    ],
  },
  {
    key: 'sample_aspect_ratio',
    group: 'Video',
    values: ['1:1', '4:3', '16:9'],
  },
  {
    key: 'display_aspect_ratio',
    group: 'Video',
    values: ['4:3', '16:9', '2.35:1', '2.39:1'],
  },
  {
    key: 'field_order',
    group: 'Video',
    values: ['progressive', 'tt', 'bb', 'tb', 'bt'],
  },
  {
    key: 'color_range',
    group: 'Video',
    values: ['tv', 'pc'],
  },
  {
    key: 'color_space',
    group: 'Video',
    values: ['bt709', 'bt2020nc', 'smpte170m', 'smpte240m'],
  },
  {
    key: 'color_transfer',
    group: 'Video',
    values: ['bt709', 'smpte2084', 'arib-std-b67'],
  },
  {
    key: 'color_primaries',
    group: 'Video',
    values: ['bt709', 'bt2020', 'smpte170m'],
  },
  {
    key: 'channels',
    group: 'Audio',
    numeric: true,
    values: ['1', '2', '6', '8'],
  },
  {
    key: 'channel_layout',
    group: 'Audio',
    values: ['mono', 'stereo', '5.1', '7.1'],
  },
  {
    key: 'sample_rate',
    group: 'Audio',
    numeric: true,
    values: ['44100', '48000', '88200', '96000', '192000'],
  },
  {
    key: 'sample_fmt',
    group: 'Audio',
    values: ['u8', 's16', 's32', 'flt', 'dbl', 's16p', 's32p', 'fltp', 'dblp'],
  },
  {
    key: 'bits_per_raw_sample',
    group: 'Audio',
    numeric: true,
    values: ['16', '20', '24', '32'],
  },
  {
    key: 'index',
    group: 'Other',
    numeric: true,
    values: ['0', '1', '2', '3'],
  },
  {
    key: 'duration',
    group: 'Other',
    numeric: true,
    values: [],
  },
  {
    key: 'nb_frames',
    group: 'Other',
    numeric: true,
    values: [],
  },
  {
    key: 'level',
    group: 'Other',
    numeric: true,
    values: ['31', '40', '41', '50', '51', '52'],
  },
];

const BY_KEY = new Map(
  FFPROBE_PROPERTIES.map((definition) => [definition.key, definition]),
);

export function isKnownFfprobeProperty(key: string): boolean {
  return BY_KEY.has(key);
}

export function isNumericFfprobeProperty(key: string): boolean {
  return BY_KEY.get(key)?.numeric === true;
}

export function ffprobeValueOptions(key: string): string[] {
  return BY_KEY.get(key)?.values ?? [];
}

export function ffprobePropertyGroups(): {
  group: FfprobePropertyGroup;
  properties: FfprobePropertyDefinition[];
}[] {
  return FFPROBE_PROPERTY_GROUPS.map((group) => ({
    group,
    properties: FFPROBE_PROPERTIES.filter((entry) => entry.group === group),
  }));
}

export function ffprobePropertySuggestions(): {
  value: string;
  label: string;
  group: string;
}[] {
  return FFPROBE_PROPERTIES.map((entry) => ({
    value: entry.key,
    label: entry.key,
    group: entry.group,
  }));
}
