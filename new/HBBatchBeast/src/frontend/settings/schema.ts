/**
 * Field schema for the settings drawer. Keeps labels, types, grouping and
 * advanced/visible decisions in one place instead of ~65 hand-written inputs.
 * Paths are relative to a single `BatchConfig`.
 */

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'number'
  | 'toggle'
  | 'select'
  | 'time';

export interface FieldSchema {
  /** Dot path inside a BatchConfig, e.g. `tab_batch.path.source_path`. */
  path: string;
  label: string;
  kind: FieldKind;
  advanced?: boolean;
  /** Grouped separately and explained before use. */
  destructive?: boolean;
  options?: { value: string; label: string; text: string }[];
  /** Config stores the selected option as a number (0/1 flags). */
  numericOptions?: boolean;
  min?: number;
  max?: number;
  help?: string;
}

export interface GroupSchema {
  id: string;
  title: string;
  fields: FieldSchema[];
}

const handBrakePresets = [
  'Very Fast 1080p30',
  'Fast 1080p30',
  'HQ 1080p30 Surround',
  'Super HQ 1080p30 Surround',
  'Very Fast 720p30',
  'Fast 720p30',
  'H.265 MKV 1080p30',
  'H.265 MKV 2160p60 4K',
];

export const settingsSchema: GroupSchema[] = [
  {
    id: 'folders',
    title: 'Folders',
    fields: [
      {
        path: 'tab_batch.path.source_path',
        label: 'Source folders',
        kind: 'multiline',
        help: 'One folder per line. Subfolders are scanned recursively.',
      },
      {
        path: 'tab_batch.path.destination_path',
        label: 'Destination folders',
        kind: 'multiline',
        help: 'One per source folder, in the same order.',
      },
      {
        path: 'tab_batch.path.temp_toggle',
        label: 'Stage conversions in temp folders',
        kind: 'toggle',
        advanced: true,
        help: 'Convert into a temp folder and move the file into the destination when it finishes.',
      },
      {
        path: 'tab_batch.path.temp_destination_path',
        label: 'Temp folders',
        kind: 'multiline',
        advanced: true,
      },
    ],
  },
  {
    id: 'encoding',
    title: 'Encoding',
    fields: [
      {
        path: 'tab_batch.FFmpeg_toggle',
        label: 'Encoder',
        kind: 'select',
        numericOptions: true,
        options: [
          { value: '0', label: 'HandBrake', text: 'HandBrake' },
          { value: '1', label: 'FFmpeg', text: 'FFmpeg' },
        ],
      },
      {
        path: 'tab_batch.custom_preset_toggle',
        label: 'Preset source',
        kind: 'select',
        numericOptions: true,
        options: [
          { value: '0', label: 'Standard preset', text: 'Standard preset' },
          { value: '1', label: 'Custom preset', text: 'Custom preset' },
        ],
      },
      {
        path: 'tab_batch.preset',
        label: 'Standard preset',
        kind: 'select',
        options: handBrakePresets.map((preset) => ({
          value: preset,
          label: preset,
          text: preset,
        })),
      },
      {
        path: 'tab_batch.custom_preset_string',
        label: 'Custom preset',
        kind: 'multiline',
        help: 'One preset per source folder. Use the exact HandBrake arguments.',
      },
      {
        path: 'tab_batch.container',
        label: 'Container',
        kind: 'text',
      },
      {
        path: 'tab_batch.advanced.file_name_suffix',
        label: 'Filename suffix',
        kind: 'multiline',
        advanced: true,
        help: 'One per source folder. Leave empty to keep the original name.',
      },
      {
        path: 'tab_batch.advanced.file_name_suffix_toggle',
        label: 'Apply filename suffixes',
        kind: 'toggle',
        advanced: true,
      },
    ],
  },
  {
    id: 'filters',
    title: 'Filters',
    fields: [
      {
        path: 'tab_batch.advanced.included_file_types',
        label: 'Included file types',
        kind: 'text',
        help: 'Comma separated, e.g. mp4,mkv,mov',
      },
      {
        path: 'tab_batch.advanced.title_word_filter',
        label: 'Exclude filenames containing',
        kind: 'text',
        help: 'Comma separated words, e.g. sample,trailer',
      },
      {
        path: 'tab_batch.advanced.min_file_size_filter_toggle',
        label: 'Minimum file size',
        kind: 'toggle',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.min_file_size_filter',
        label: 'Minimum size (MB)',
        kind: 'number',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.max_file_size_filter_toggle',
        label: 'Maximum file size',
        kind: 'toggle',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.max_file_size_filter',
        label: 'Maximum size (MB)',
        kind: 'number',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.included_property_filter',
        label: 'Include files with properties',
        kind: 'text',
        advanced: true,
        help: 'e.g. codec_name=h264,width=1920',
      },
      {
        path: 'tab_batch.advanced.excluded_property_filter',
        label: 'Exclude files with properties',
        kind: 'text',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.copy_srt_files_toggle',
        label: 'Copy .srt sidecars',
        kind: 'toggle',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.copy_filtered_files_toggle',
        label: 'Copy filtered-out files to the destination',
        kind: 'toggle',
        advanced: true,
      },
    ],
  },
  {
    id: 'handling',
    title: 'File handling',
    fields: [
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
        label: 'Custom batch file to run after each file',
        kind: 'text',
        advanced: true,
      },
      {
        path: 'tab_batch.advanced.low_process_priority_toggle',
        label: 'Run conversions at low priority',
        kind: 'toggle',
        advanced: true,
      },
    ],
  },
  {
    id: 'system',
    title: 'System',
    fields: [
      {
        path: 'tab_system.worker_instance_number',
        label: 'Worker processes',
        kind: 'number',
        min: 1,
        max: 32,
      },
      {
        path: 'tab_system.max_queue_view_size',
        label: 'Queue view limit',
        kind: 'number',
        advanced: true,
      },
      {
        path: 'tab_system.save_worker_logs_toggle',
        label: 'Save verbose worker logs',
        kind: 'toggle',
        advanced: true,
        help: 'Produces very large log files.',
      },
    ],
  },
];
