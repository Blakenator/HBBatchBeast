/**
 * Field schema for the settings drawer. Keeps labels, types, grouping,
 * visibility and advanced decisions in one place instead of hand-writing every
 * control in SettingsForm.
 *
 * Paths are relative to a single `BatchConfig`.
 */

import { DEFAULT_TEMP_MARKER_TOGGLE } from '../../common';

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'number'
  | 'toggle'
  | 'select'
  | 'segmented'
  | 'preset-rows'
  | 'custom-args-rows'
  | 'suffix-rows'
  | 'path';

export type EncoderMode = 'handbrake' | 'ffmpeg';

export interface FieldOption {
  value: string;
  label: string;
  text: string;
  title?: string;
  /** Encoders for which this option is valid; omitted means all. */
  modes?: EncoderMode[];
}

export interface FieldCondition {
  path: string;
  equals?: string | number;
  notEquals?: string | number;
}

export interface FieldVisibility {
  all?: FieldCondition[];
  any?: FieldCondition[];
}

export interface FieldSchema {
  /** Dot path inside a BatchConfig, e.g. `tab_batch.path.source_path`. */
  path: string;
  label: string;
  kind: FieldKind;
  advanced?: boolean;
  /** Grouped separately and explained before use. */
  destructive?: boolean;
  /** Explains why an option is present but cannot be changed. */
  disabledReason?: string;
  options?: FieldOption[];
  /** Config stores the selected option as a number (0/1 flags). */
  numericOptions?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
  placeholder?: string;
  /** Visibility conditions; the field is hidden until they hold. */
  showWhen?: FieldVisibility;
  /** Single path fields can open the OS picker. */
  browse?: 'folder' | 'file';
  browseFilters?: { name: string; extensions: string[] }[];
  /** Value a toggle shows when the profile has not stored one yet. */
  defaultValue?: 0 | 1;
  /** Rendered above the paired folder rows (e.g. the temp-staging switch). */
  beforeRows?: boolean;
  /** Aligned list fields follow the source folder rows. */
  alignTo?: string;
}

export interface FolderRowsSchema {
  source: string;
  destination: string;
  temp: string;
  tempToggle: string;
}

export interface GroupSchema {
  id: string;
  title: string;
  description?: string;
  /** Paired path editor rendered before the group's fields. */
  pathRows?: FolderRowsSchema;
  fields: FieldSchema[];
}

/** Suggestions used when HandBrakeCLI cannot be queried. */
export const FALLBACK_HANDBRAKE_PRESETS = [
  'Very Fast 1080p30',
  'Fast 1080p30',
  'HQ 1080p30 Surround',
  'Super HQ 1080p30 Surround',
  'Very Fast 720p30',
  'Fast 720p30',
  'H.265 MKV 1080p30',
  'H.265 MKV 2160p60 4K',
  'Very Fast 2160p60 4K HEVC',
  'Very Fast 2160p60 4K AV1',
];

export const settingsSchema: GroupSchema[] = [
  {
    id: 'folders',
    title: 'Folders',
    description:
      'Each source folder maps to one destination folder. Subfolders are scanned recursively, and missing output folders are created automatically.',
    pathRows: {
      source: 'tab_batch.path.source_path',
      destination: 'tab_batch.path.destination_path',
      temp: 'tab_batch.path.temp_destination_path',
      tempToggle: 'tab_batch.path.temp_toggle',
    },
    fields: [
      {
        path: 'tab_batch.path.temp_toggle',
        label: 'Stage conversions in temp folders',
        kind: 'toggle',
        advanced: true,
        beforeRows: true,
        help: 'Convert into a temp folder and move the file into the destination when it finishes.',
      },
    ],
  },
  {
    id: 'encoding',
    title: 'Encoding',
    description:
      'Choose the encoder once, then give each source folder the preset or arguments it should use.',
    fields: [
      {
        path: 'tab_batch.FFmpeg_toggle',
        label: 'Encoder',
        kind: 'segmented',
        numericOptions: true,
        options: [
          { value: '0', label: 'HandBrake', text: 'HandBrake' },
          { value: '1', label: 'FFmpeg', text: 'FFmpeg' },
        ],
        help: 'HandBrake uses presets; FFmpeg uses your own command arguments.',
      },
      {
        path: 'tab_batch.custom_preset_string',
        label: 'Preset per folder',
        kind: 'preset-rows',
        alignTo: 'tab_batch.path.source_path',
      },
      {
        path: 'tab_batch.container',
        label: 'Container',
        kind: 'select',
        options: [
          { value: '.mp4', label: '.mp4 (MP4)', text: '.mp4 (MP4)' },
          { value: '.mkv', label: '.mkv (Matroska)', text: '.mkv (Matroska)' },
          { value: '.m4v', label: '.m4v (M4V)', text: '.m4v (M4V)' },
          {
            value: '.webm',
            label: '.webm (WebM)',
            text: '.webm (WebM)',
            modes: ['ffmpeg'],
          },
          {
            value: '.mov',
            label: '.mov (QuickTime)',
            text: '.mov (QuickTime)',
            modes: ['ffmpeg'],
          },
          {
            value: '.avi',
            label: '.avi (AVI)',
            text: '.avi (AVI)',
            modes: ['ffmpeg'],
          },
        ],
        help: 'Only containers supported by the selected encoder are offered. HandBrake writes MP4, M4V and MKV.',
      },
      {
        path: 'tab_batch.advanced.file_name_suffix_toggle',
        label: 'Apply a filename suffix per folder',
        kind: 'toggle',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.file_name_suffix',
        label: 'Filename suffix per folder',
        kind: 'suffix-rows',
        alignTo: 'tab_batch.path.source_path',
        advanced: true,
        showWhen: {
          all: [
            {
              path: 'tab_batch.advanced.file_name_suffix_toggle',
              equals: 1,
            },
          ],
        },
        help: 'Leave a row empty to keep the original name for that folder.',
      },
    ],
  },
  {
    id: 'handling',
    title: 'File handling',
    description: 'What happens to the original file and extras once a conversion succeeds.',
    fields: [
      {
        path: 'tab_batch.advanced.temp_marker_toggle',
        label: 'Mark in-progress conversions with .temp',
        kind: 'toggle',
        advanced: true,
        defaultValue: DEFAULT_TEMP_MARKER_TOGGLE,
        help: 'Files are written as name.temp.mkv and renamed to name.mkv only after the conversion finishes, so a stopped run leaves unfinished files clearly marked.',
      },
      {
        path: 'tab_batch.advanced.delete_source_files_toggle',
        label: 'Delete source files after a successful conversion',
        kind: 'toggle',
        destructive: true,
        help: 'Applies only to files that converted successfully.',
      },
      {
        path: 'tab_batch.advanced.replace_original_file_if_converted_is_smaller_toggle',
        label: 'Replace the original when the result is smaller',
        kind: 'toggle',
        destructive: true,
      },
      {
        path: 'tab_batch.advanced.replace_original_file_always_toggle',
        label: 'Always replace the original',
        kind: 'toggle',
        destructive: true,
        help: 'Overrides the "smaller only" option.',
      },
      {
        path: 'tab_batch.advanced.remove_filename_apostrophes',
        label: 'Remove apostrophes from filenames',
        kind: 'toggle',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.reverse_file_queue',
        label: 'Reverse the file queue',
        kind: 'toggle',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.custom_bat_path',
        label: 'Batch file to run after each file',
        kind: 'path',
        advanced: true,
        browse: 'file',
        browseFilters: [
          { name: 'Batch scripts', extensions: ['bat', 'cmd', 'sh'] },
          { name: 'All files', extensions: ['*'] },
        ],
        placeholder: 'Optional',
      },
    ],
  },
];
