import os from 'os';
import path from 'path';
import { AppError } from '@superflag/super-ipc-core';
import {
  BatchOperationMode,
  BatchTabConfig,
  RunBatchOperationProps,
  parseMappedRows,
} from '../../common';
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

export function defaultLogDirectory(homePath: string = os.homedir()): string {
  return path.join(homePath, 'Documents/HBBatchBeast/Logs');
}

export interface BuildQueueBuildConfigOptions extends RunBatchOperationProps {
  /** Overrides the logs directory (tests pass a temp home). */
  logDirectory?: string;
}

export function buildQueueBuildConfig({
  config,
  operationMode,
  logDirectory = defaultLogDirectory(),
}: BuildQueueBuildConfigOptions): QueueBuildConfig {
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

  if (sources.length === 0) {
    throw new AppError('At least one source folder is required', {
      context: { operationMode },
    });
  }
  if (destinations.length !== sources.length) {
    throw new AppError('Each source folder needs a destination folder', {
      context: { sources: sources.length, destinations: destinations.length },
    });
  }
  if (useTempFolder && tempDestinations.length !== sources.length) {
    throw new AppError('Each source folder needs a temporary folder', {
      context: {
        sources: sources.length,
        tempDestinations: tempDestinations.length,
      },
    });
  }

  // One suffix per source folder: queueBuild indexes this per source, so a short
  // array is what produced `<name>undefined.mp4` destinations (D1). Blank rows
  // are preserved so a suffix stays attached to its own source row.
  const configuredSuffixes =
    advanced.file_name_suffix_toggle === 1
      ? parseMappedRows(advanced.file_name_suffix)
      : [];
  const fileSuffixes = padTo(sources.length, configuredSuffixes, '');

  // FFmpeg has no HandBrake `-Z` presets; its command arguments always live in
  // `custom_preset_string` (one `input,output` pair per source row).
  const ffmpegMode = batch.FFmpeg_toggle === 1;
  const customRows = parseMappedRows(batch.custom_preset_string);
  const hasCustomRows = customRows.some((row) => row.trim().length > 0);
  const configuredPresets = ffmpegMode
    ? customRows
    : (hasCustomRows ? customRows : parseMappedRows(batch.preset)).map(
        toPresetArgument,
      );
  const presets = padTo(
    sources.length,
    configuredPresets,
    configuredPresets.find((preset) => preset.trim().length > 0) ?? '',
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
    logDirectory,
  };
}
