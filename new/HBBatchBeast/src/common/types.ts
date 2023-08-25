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

export interface HealthTabConfig {
  path: {
    corrupt_destination_path: string;
  };
  move_corrupt_files_toggle: 0 | 1;
  thorough_health_check_toggle: 0 | 1;
  thorough_health_check_repair_toggle: 0 | 1;
  crf_repair_value: string;
}

export interface BatchTabConfig {
  path: {
    source_path: string;
    temp_toggle: 0 | 1;
    destination_path: string;
    temp_destination_path: string;
  };
  advanced: {
    periodic_scan_interval: string;
    daily_run_time: string;
    daily_run_time_end: string;
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
    delete_source_files_toggle: 0 | 1;
    replace_original_file_if_converted_is_smaller_toggle: 0 | 1;
    replace_original_file_always_toggle: 0 | 1;
    copy_srt_files_toggle: 0 | 1;
    auto_create_folders_toggle: 0 | 1;
    custom_bat_path: string;
    low_process_priority_toggle: 0 | 1;
    remove_filename_apostrophes: number;
    reverse_file_queue: number;
  };
  HandBrake_toggle: 0 | 1;
  FFmpeg_toggle: 0 | 1;
  custom_preset_toggle: 0 | 1;
  preset: string;
  custom_preset_string: string;
  container: string;
  periodic_scanning_toggle: 0 | 1;
  daily_scanning_toggle: 0 | 1;
}

export interface RemoteTabConfig {
  remote_view_toggle: 0 | 1;
}

export interface SystemTabConfig {
  worker_instance_number: string;
  max_queue_view_size: string;
  run_on_program_startup_toggle: 0 | 1;
  save_worker_logs_toggle: 0 | 1;
  email_address: string;
  smtp_server: string;
}

export interface BatchConfig {
  tab_health: Partial<HealthTabConfig>;
  tab_batch: Partial<BatchTabConfig>;
  tab_remote: Partial<RemoteTabConfig>;
  tab_system: Partial<SystemTabConfig>;

  // new props
  name?: string;
}

export interface GlobalAppConfig {
  lang: string;
  selected_config: number;
  version_message: string;
  api_key: string;
  configs: BatchConfig[];
}

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export const ASYNC_REPLY_SUFFIX = '-ASYNC_REPLY';
