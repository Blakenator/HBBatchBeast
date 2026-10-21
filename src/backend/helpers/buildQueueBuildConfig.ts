import { AppError } from '@superflag/super-ipc-core';
import { BatchOperationMode, BatchTabConfig, RunBatchOperationProps } from '../../common';
import { QueueBuildConfig } from '../processes/protocol';

/**
 * Builds the configuration payload handed to the `queueBuild` child process.
 *
 * This used to be a 15-slot positional array read back by index, which silently
 * produced wrong paths whenever an entry was missing (MIGRATION_STATUS.md D1).
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

/** queueBuild concatenates this onto the file name, so it must keep its dot. */
function normalizeContainer(container?: string): string {
  const trimmed = (container ?? '').trim();
  if (!trimmed) return '.mp4';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function toPresetArgument(preset: string): string {
  return preset.startsWith('-') ? preset : `-Z "${preset}"`;
}

const SUPPORTED_MODES: BatchOperationMode[] = [
  BatchOperationMode.ScanOnly,
  BatchOperationMode.ScanAndConvert,
];

export function buildQueueBuildConfig({
  config,
  operationMode,
}: RunBatchOperationProps): QueueBuildConfig {
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

  const sources = splitLines(paths.source_path);
  const destinations = splitLines(paths.destination_path);
  const useTempFolder = paths.temp_toggle === 1;
  const tempDestinations = useTempFolder
    ? splitLines(paths.temp_destination_path)
    : [];

  // One suffix per source folder: queueBuild indexes this per source, so a short
  // array is what produced `<name>undefined.mp4` destinations (D1).
  const configuredSuffixes =
    advanced.file_name_suffix_toggle === 1
      ? splitLines(advanced.file_name_suffix)
      : [];
  const fileSuffixes = padTo(sources.length, configuredSuffixes, '');

  const configuredPresets =
    batch.custom_preset_toggle === 1
      ? splitLines(batch.custom_preset_string)
      : splitLines(batch.preset).map(toPresetArgument);
  const presets = padTo(
    sources.length,
    configuredPresets,
    configuredPresets[0] ?? '',
  );

  const includedFileTypes =
    advanced.copy_srt_files_toggle === 1
      ? `${advanced.included_file_types ?? ''},srt,SRT`
      : (advanced.included_file_types ?? '');

  return {
    sources,
    destinations,
    tempDestinations,
    useTempFolder,
    includedFileTypes,
    container: normalizeContainer(batch.container),
    mode: operationMode,
    presets,
    titleWordFilter: advanced.title_word_filter ?? '',
    replaceIfSmaller:
      advanced.replace_original_file_if_converted_is_smaller_toggle === 1,
    fileSuffixes,
    removeApostrophes: advanced.remove_filename_apostrophes === 1,
    replaceAlways: advanced.replace_original_file_always_toggle === 1,
    reverseQueue: advanced.reverse_file_queue === 1,
  };
}
