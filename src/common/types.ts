import type { FilterExpression, FilterTrace } from './filterExpression';

export enum BackendResultMode {
  Init = 'INIT',
  Progress = 'PROGRESS',
  Complete = 'COMPLETE',
}

export interface BackendResult<T = string> {
  error?: {
    message: string;
  } & any;
  content?: T;
  resultMode: BackendResultMode;
  callId?: number;
}

export interface BatchTabConfig {
  path: {
    source_path: string;
    temp_toggle: 0 | 1;
    destination_path: string;
    temp_destination_path: string;
  };
  advanced: {
    file_name_suffix: string;
    file_name_suffix_toggle: 0 | 1;
    included_file_types: string;
    min_file_size_filter_toggle: 0 | 1;
    max_file_size_filter_toggle: 0 | 1;
    min_file_size_filter: string;
    max_file_size_filter: string;
    title_word_filter: string;
    included_property_filter: string;
    excluded_property_filter: string;
    included_property_filter_any_toggle: 0 | 1;
    included_property_filter_all_toggle: 0 | 1;
    excluded_property_filter_any_toggle: 0 | 1;
    excluded_property_filter_all_toggle: 0 | 1;
    copy_filtered_files_toggle: 0 | 1;
    /** Structured scan filter rules; legacy flat fields are compiled when absent. */
    filter_expression?: FilterExpression;
    /** Queue files even when a non-empty output already exists. */
    include_converted_files_toggle: 0 | 1;
    /** Write conversions as `name.temp.ext` and rename them when finished. */
    temp_marker_toggle: 0 | 1;
    delete_source_files_toggle: 0 | 1;
    replace_original_file_if_converted_is_smaller_toggle: 0 | 1;
    replace_original_file_always_toggle: 0 | 1;
    copy_srt_files_toggle: 0 | 1;
    auto_create_folders_toggle: 0 | 1;
    custom_bat_path: string;
    low_process_priority_toggle: 0 | 1;
    remove_filename_apostrophes: 0 | 1;
    reverse_file_queue: number;
  };
  HandBrake_toggle: 0 | 1;
  FFmpeg_toggle: 0 | 1;
  /** @deprecated Preset selection now lives in `custom_preset_string`. */
  custom_preset_toggle: 0 | 1;
  /** @deprecated Read as a fallback for profiles saved before the unified field. */
  preset: string;
  custom_preset_string: string;
  container: string;
}

/** App-wide preferences. Legacy files may still store these under each profile. */
export interface GlobalSettingsConfig {
  worker_instance_number: string;
  save_worker_logs_toggle: 0 | 1;
}

/**
 * One saved profile. Scheduling, health-check, remote and email settings are no
 * longer part of the app; legacy files may still contain those keys, which are
 * carried through untouched (see LoadConfiguration) instead of being rejected.
 */
export interface BatchConfig {
  tab_batch: Partial<BatchTabConfig>;
  /** @deprecated Read only for migrating app-wide preferences from old files. */
  tab_system?: Partial<GlobalSettingsConfig>;
  name?: string;
}

export interface GlobalAppConfig {
  lang: string;
  app_settings?: Partial<GlobalSettingsConfig>;
  selected_config: number;
  version_message: string;
  configs: BatchConfig[];
}

export type DeepPartial<T> = T extends object
  ? {
    [P in keyof T]?: DeepPartial<T[P]>;
  }
  : T;

export const ASYNC_REPLY_SUFFIX = '-ASYNC_REPLY';

export enum BatchOperationMode {
  ScanOnly = 'scanOnly',
  ScanAndConvert = 'scanAndConvert',
}

export interface MediaStreamInfo {
  index: number;
  type: string;
  codec?: string;
  width?: number;
  height?: number;
  channels?: number;
  channelLayout?: string;
  sampleRate?: number;
  bitRate?: number;
  frameRate?: string;
  duration?: number;
  language?: string;
  title?: string;
}

export interface MediaInfo {
  path: string;
  container?: string;
  duration?: number;
  size?: number;
  bitRate?: number;
  streams: MediaStreamInfo[];
}

export interface DiagnosticsInfo {
  logDir: string;
  configDir: string;
  journalPath: string;
  journalExists: boolean;
  /** Status recorded in the journal; `running`/`paused` means it was interrupted. */
  journalStatus?: string;
  logs: { name: string; path: string; size: number }[];
  caches: { name: string; path: string; size: number; exists: boolean }[];
}

/** Tray indicator states, shared by the renderer and the tray module. */
export type TrayStatus = 'idle' | 'running' | 'paused' | 'error';

export type PathPickerKind = 'folder' | 'file';

export interface PathPickerRequest {
  kind: PathPickerKind;
  /** Lets the user select several paths in one dialog. */
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface PathPickerResult {
  canceled: boolean;
  paths: string[];
}

export interface HandBrakePreset {
  name: string;
  category: string;
  description?: string;
}

export interface HandBrakePresetScan {
  /** False when HandBrakeCLI could not be run or returned nothing usable. */
  available: boolean;
  executable?: string;
  presets: HandBrakePreset[];
  error?: string;
}

/** What the worker should do with one scanned file. */
export type RunItemAction = 'encode' | 'copy' | 'skip';

export interface ConversionItem {
  path: string;
  preset: string;
  destinationPath?: string;
  /** Final destination when a temp folder is configured. */
  destinationFinalPath?: string;
  /** Derived from the scanner's filter flags; defaults to `encode`. */
  action?: RunItemAction;
  /** Why the scanner excluded this file; set for `skip` items. */
  excludedReason?: string;
}

export interface RunBatchOperationProps {
  operationMode?: BatchOperationMode;
  config: GlobalAppConfig;
}

export interface RunBatchOperationResult {
  fileList: {
    path: string;
    worker?: number;
    presetIndex?: number;
    /** Resolved preset argument for this file, e.g. `-Z "Very Fast 1080p30"`. */
    preset?: string;
    /** Converted output path computed by the scanner, when known. */
    destinationPath?: string;
    /** Final destination when temp staging is enabled. */
    destinationFinalPath?: string;
    /** Copy or skip files the scanner already flagged. */
    action?: RunItemAction;
    /** Why the scanner will not convert this file. */
    excludedReason?: string;
    /** Per-stage filter decision, shown in the queue trace popover. */
    filterTrace?: FilterTrace;
    extraActions: {
      copiedFromFilter?: boolean;
      skippedFromFilter?: boolean;
      copiedSrt?: boolean;
    };
  }[];
  totalCount: number;
  unconvertedFilesCount: number;
  discoveredQueueCount: number;
  /** Files ignored before evaluation because their type cannot match. */
  typeFilteredCount?: number;
}
