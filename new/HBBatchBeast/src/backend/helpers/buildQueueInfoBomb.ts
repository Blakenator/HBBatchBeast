import { AppError } from '@superflag/super-ipc-core';
import {
  BatchOperationMode,
  BatchTabConfig,
  RunBatchOperationProps,
} from '../../common';

/**
 * `queueBuild` reads its configuration as a positional array (see
 * MIGRATION_STATUS.md §3). Building that array here keeps the index contract in
 * one testable place instead of inside the IPC handler.
 */

function splitLines(value?: string): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Repeats/pads `values` to `length`, filling gaps with `fallback`. */
function padTo(length: number, values: string[], fallback: string): string[] {
  return Array.from({ length }, (_, index) => values[index] ?? fallback);
}

function toPresetArgument(preset: string): string {
  return preset.startsWith('-') ? preset : `-Z "${preset}"`;
}

const SUPPORTED_MODES: BatchOperationMode[] = [
  BatchOperationMode.ScanOnly,
  BatchOperationMode.ScanAndConvert,
];

export function buildQueueInfoBomb({
  config,
  operationMode,
}: RunBatchOperationProps): unknown[] {
  if (!operationMode || !SUPPORTED_MODES.includes(operationMode)) {
    throw new AppError('Unsupported batch operation mode', {
      context: { operationMode },
    });
  }

  const currentConfig = config.configs[config.selected_config];
  if (!currentConfig) {
    throw new AppError('Selected configuration does not exist', {
      context: { selected_config: config.selected_config },
    });
  }

  const batch: Partial<BatchTabConfig> = currentConfig.tab_batch ?? {};
  const advanced: Partial<BatchTabConfig['advanced']> = batch.advanced ?? {};
  const paths: Partial<BatchTabConfig['path']> = batch.path ?? {};

  const sourcePaths = splitLines(paths.source_path);
  const destinationPaths = splitLines(paths.destination_path);
  const useTempFolder = paths.temp_toggle === 1;
  const tempDestinationPaths = useTempFolder
    ? splitLines(paths.temp_destination_path)
    : [];

  // One suffix per source folder: queueBuild indexes this array per source, so a
  // short array is what produced `<name>undefined.mp4` destinations (D1).
  const configuredSuffixes =
    advanced.file_name_suffix_toggle === 1
      ? splitLines(advanced.file_name_suffix)
      : [];
  const fileSuffixes = padTo(sourcePaths.length, configuredSuffixes, '');

  const configuredPresets =
    batch.custom_preset_toggle === 1
      ? splitLines(batch.custom_preset_string)
      : splitLines(batch.preset).map(toPresetArgument);
  const presets = padTo(
    sourcePaths.length,
    configuredPresets,
    configuredPresets[0] ?? '',
  );

  const includedFileTypes = advanced.copy_srt_files_toggle === 1
    ? `${advanced.included_file_types ?? ''},srt,SRT`
    : (advanced.included_file_types ?? '');

  return [
    'queueInfoBomb',
    sourcePaths,
    destinationPaths,
    tempDestinationPaths,
    useTempFolder,
    includedFileTypes,
    batch.container ?? '.mp4',
    operationMode,
    presets,
    advanced.title_word_filter ?? '',
    advanced.replace_original_file_if_converted_is_smaller_toggle === 1,
    fileSuffixes,
    advanced.remove_filename_apostrophes === 1,
    advanced.replace_original_file_always_toggle === 1,
    advanced.reverse_file_queue === 1,
  ];
}
