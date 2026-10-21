import {
  BatchTabConfig,
  ConversionItem,
  GlobalAppConfig,
  resolveGlobalSettings,
} from '../../common';
import { WorkerItemConfig } from './workerProtocol';
import { userPresetFiles } from '../helpers/handBrakePresets';

function truthy(value: number | undefined): boolean {
  return value === 1;
}

function handBrakeCliPath(platform: NodeJS.Platform): string {
  // The bundled Windows binary sits next to the app resources; elsewhere the
  // user supplies HandBrakeCLI on PATH.
  return platform === 'win32'
    ? 'HandBrakeCLI.exe'
    : 'HandBrakeCLI';
}

/**
 * Translates the app configuration plus one queue item into the worker payload.
 * Previously this was assembled inline from 36 DOM reads.
 */
export function buildWorkerItemConfig(
  config: GlobalAppConfig,
  item: ConversionItem,
  index: number,
  platform: NodeJS.Platform = process.platform,
  presetImportFiles: string[] = userPresetFiles(),
): WorkerItemConfig {
  const current = config.configs[config.selected_config];
  const batch: Partial<BatchTabConfig> = current?.tab_batch ?? {};
  const advanced: Partial<BatchTabConfig['advanced']> = batch.advanced ?? {};
  const globalSettings = resolveGlobalSettings(config);

  return {
    queueNumber: index,
    skipOrCopy: 0,
    copyOnOff: truthy(advanced.copy_filtered_files_toggle),
    replaceOriginalFile: truthy(
      advanced.replace_original_file_if_converted_is_smaller_toggle,
    ),
    // Health check / repair is out of scope (S26).
    moveCorruptFileOnOff: false,
    corruptDestinationPath: '',
    mode: 'scanAndConvert',
    itemChecked: true,
    fileFiltersInclude: advanced.included_property_filter ?? '',
    fileFiltersExclude: advanced.excluded_property_filter ?? '',
    replaceOriginalFileAlways: truthy(
      advanced.replace_original_file_always_toggle,
    ),
    includeAnyProperties: truthy(advanced.included_property_filter_any_toggle),
    includeAllProperties: truthy(advanced.included_property_filter_all_toggle),
    excludeAnyProperties: truthy(advanced.excluded_property_filter_any_toggle),
    excludeAllProperties: truthy(advanced.excluded_property_filter_all_toggle),
    handBrakeMode: batch.FFmpeg_toggle !== 1,
    ffmpegMode: batch.FFmpeg_toggle === 1,
    deleteSourceFiles: truthy(advanced.delete_source_files_toggle),
    customBatOn: Boolean(advanced.custom_bat_path),
    tempFolderSelected: truthy(batch.path?.temp_toggle),
    sourcePath: item.path,
    preset: item.preset,
    destinationPath: item.destinationPath ?? '',
    destinationFinalPath: '',
    minFileSizeOnOff: truthy(advanced.min_file_size_filter_toggle),
    minFileSize: advanced.min_file_size_filter ?? '',
    maxFileSizeOnOff: truthy(advanced.max_file_size_filter_toggle),
    maxFileSize: advanced.max_file_size_filter ?? '',
    thoroughHealthCheck: false,
    repairFile: false,
    repairCrfValue: '23',
    handBrakeCliPath: handBrakeCliPath(platform),
    ffmpegPath: 'ffmpeg',
    saveWorkerLogs: truthy(globalSettings.save_worker_logs_toggle),
    handBrakePresetImportFiles: presetImportFiles,
  };
}
