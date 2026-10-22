import { AppError } from '@superflag/super-ipc-core';
import {
  BatchTabConfig,
  ConversionItem,
  GlobalAppConfig,
  parsePropertyFilters,
  resolveGlobalSettings,
} from '../../common';
import { userPresetFiles } from '../helpers/handBrakePresets';
import { WorkerItemConfig } from '../workers/protocol';

function truthy(value: number | undefined): boolean {
  return value === 1;
}

function handBrakeCliPath(platform: NodeJS.Platform): string {
  // The bundled Windows binary sits next to the app resources; elsewhere the
  // user supplies HandBrakeCLI on PATH.
  return platform === 'win32' ? 'HandBrakeCLI.exe' : 'HandBrakeCLI';
}

function filterMode(
  anyToggle: number | undefined,
  allToggle: number | undefined,
): 'off' | 'any' | 'all' {
  if (truthy(allToggle)) return 'all';
  if (truthy(anyToggle)) return 'any';
  return 'off';
}

function parseSizeMb(
  toggle: number | undefined,
  raw: string | undefined,
  label: string,
): number | undefined {
  if (!truthy(toggle)) return undefined;
  const trimmed = (raw ?? '').trim();
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value) || value < 0) {
    throw new AppError(`Invalid ${label}`, { context: { value: raw } });
  }
  return value;
}

/**
 * Translates the app configuration plus one queue item into the validated
 * worker payload.
 */
export function buildWorkerItemConfig(
  config: GlobalAppConfig,
  item: ConversionItem,
  index: number,
  platform: NodeJS.Platform = process.platform,
  presetImportFiles: string[] = userPresetFiles(),
): WorkerItemConfig {
  const current = config.configs[config.selected_config];
  if (!current) {
    throw new AppError('Selected configuration does not exist', {
      context: { selected_config: config.selected_config },
    });
  }

  const batch: Partial<BatchTabConfig> = current.tab_batch ?? {};
  const advanced: Partial<BatchTabConfig['advanced']> = batch.advanced ?? {};
  const globalSettings = resolveGlobalSettings(config);
  const action = item.action ?? 'encode';
  const tempFolder = truthy(batch.path?.temp_toggle);

  if (!item.path.trim()) {
    throw new AppError('Queue item has no source path', { context: { index } });
  }

  const outputPath =
    item.destinationPath?.trim() || (action === 'skip' ? item.path : '');
  if (!outputPath) {
    throw new AppError('Queue item has no output path', {
      context: { index, sourcePath: item.path },
    });
  }
  const finalPath = tempFolder
    ? item.destinationFinalPath?.trim() || (action === 'skip' ? outputPath : '')
    : outputPath;
  if (!finalPath) {
    throw new AppError('Queue item has no final destination', {
      context: { index, sourcePath: item.path },
    });
  }

  const ffmpeg = batch.FFmpeg_toggle === 1;
  const encoder = {
    kind: ffmpeg ? ('ffmpeg' as const) : ('handbrake' as const),
    executable: ffmpeg ? 'ffmpeg' : handBrakeCliPath(platform),
    preset: item.preset,
    presetImportFiles: ffmpeg ? [] : presetImportFiles,
  };

  const minMb = parseSizeMb(
    advanced.min_file_size_filter_toggle,
    advanced.min_file_size_filter,
    'minimum file size',
  );
  const maxMb = parseSizeMb(
    advanced.max_file_size_filter_toggle,
    advanced.max_file_size_filter,
    'maximum file size',
  );

  return {
    queueNumber: index,
    sourcePath: item.path,
    outputPath,
    finalPath,
    action,
    ...(action === 'skip'
      ? { skipReason: item.excludedReason ?? 'Excluded by the file filter' }
      : {}),
    copyFilteredFiles: truthy(advanced.copy_filtered_files_toggle),
    encoder,
    deleteSource: truthy(advanced.delete_source_files_toggle),
    replaceOriginal: truthy(advanced.replace_original_file_always_toggle)
      ? 'always'
      : truthy(
            advanced.replace_original_file_if_converted_is_smaller_toggle,
          )
        ? 'smaller'
        : 'never',
    customBatPath: (advanced.custom_bat_path ?? '').trim(),
    lowPriority: truthy(advanced.low_process_priority_toggle),
    saveWorkerLogs: truthy(globalSettings.save_worker_logs_toggle),
    filters: {
      include: {
        mode: filterMode(
          advanced.included_property_filter_any_toggle,
          advanced.included_property_filter_all_toggle,
        ),
        rows: parsePropertyFilters(advanced.included_property_filter),
      },
      exclude: {
        mode: filterMode(
          advanced.excluded_property_filter_any_toggle,
          advanced.excluded_property_filter_all_toggle,
        ),
        rows: parsePropertyFilters(advanced.excluded_property_filter),
      },
      size: {
        ...(minMb !== undefined ? { minMb } : {}),
        ...(maxMb !== undefined ? { maxMb } : {}),
      },
    },
  };
}
