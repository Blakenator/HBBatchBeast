import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppError } from '@superflag/super-ipc-core';
import {
  BatchOperationMode,
  BatchTabConfig,
  RunBatchOperationProps,
  parseMappedRows,
  resolveFilterExpression,
  validateFilterExpression,
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
  /** Run journal used to find outputs from interrupted/failed items. */
  journalPath?: string;
}

interface JournalItem {
  state?: string;
  destinationPath?: string;
  destinationFinalPath?: string;
}

interface RunJournal {
  startedAt?: number;
  items?: JournalItem[];
}

/**
 * Outputs the last run did not finish. An output that predates the run is from
 * an earlier, completed attempt and stays trusted: stopping a run marks queued
 * items cancelled without touching their existing files, and treating those as
 * untrusted would re-queue the whole library on every stop.
 */
function unfinishedOutputs(journalPath: string): string[] {
  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as RunJournal;
    const unfinished = new Set(['running', 'cancelled', 'error']);
    const startedAt = journal.startedAt;
    const paths = (journal.items ?? [])
      .filter((item) => unfinished.has(item.state ?? ''))
      .flatMap((item) => [item.destinationPath, item.destinationFinalPath])
      .filter((value): value is string => Boolean(value))
      .filter((output) => {
        if (typeof startedAt !== 'number') return true;
        try {
          return fs.statSync(output).mtimeMs >= startedAt;
        } catch {
          // A missing output cannot be trusted as converted; keep it marked.
          return true;
        }
      });
    return [...new Set(paths)];
  } catch {
    return [];
  }
}

export function buildQueueBuildConfig({
  config,
  operationMode,
  logDirectory = defaultLogDirectory(),
  journalPath = path.join(
    os.homedir(),
    'Documents/HBBatchBeast/Config/run-journal.json',
  ),
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

  const filterExpression = resolveFilterExpression(advanced);
  const expressionProblems = validateFilterExpression(filterExpression);
  if (expressionProblems.length > 0) {
    throw new AppError('Filter rules are invalid', {
      context: { problems: expressionProblems },
    });
  }

  return {
    sources,
    destinations,
    tempDestinations,
    useTempFolder,
    filterExpression,
    copyFilteredFiles: advanced.copy_filtered_files_toggle === 1,
    copySrtFiles: advanced.copy_srt_files_toggle === 1,
    container: normalizeContainer(batch.container),
    mode: operationMode,
    presets,
    replaceIfSmaller:
      advanced.replace_original_file_if_converted_is_smaller_toggle === 1,
    fileSuffixes,
    removeApostrophes: advanced.remove_filename_apostrophes === 1,
    replaceAlways: advanced.replace_original_file_always_toggle === 1,
    reverseQueue: advanced.reverse_file_queue === 1,
    logDirectory,
    untrustedOutputs: unfinishedOutputs(journalPath),
  };
}
