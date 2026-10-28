import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppError } from '@superflag/super-ipc-core';
import {
  BatchOperationMode,
  BatchTabConfig,
  ConversionPreset,
  Library,
  RunBatchOperationProps,
  outputContainerExtension,
  parseMappedRows,
  presetCatalog,
  resolveFilterExpression,
  validateFilterExpression,
  validateLibrary,
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

function toPresetArgument(preset: string): string {
  return preset.startsWith('-') ? preset : `-Z "${preset}"`;
}

function buildLibraryQueueConfig(
  library: Library,
  presets: ConversionPreset[],
  operationMode: BatchOperationMode,
  logDirectory: string,
  journalPath: string,
): QueueBuildConfig {
  const problems = validateLibrary(library, presets);
  if (problems.length > 0) {
    throw new AppError('Library configuration is invalid', {
      context: { problems },
    });
  }
  const sources = library.folders.map((folder) => folder.source.trim());
  const destinations = library.folders.map((folder) =>
    folder.destination.trim(),
  );
  if (sources.length === 0) {
    throw new AppError('At least one source folder is required', {
      context: { operationMode },
    });
  }
  const incomplete = library.folders.findIndex(
    (folder) => !folder.source.trim() || !folder.destination.trim(),
  );
  if (incomplete !== -1) {
    throw new AppError('Each source folder needs a destination folder', {
      context: { row: incomplete + 1 },
    });
  }
  const useTempFolder = library.defaults.temp_toggle === 1;
  const tempDestinations = useTempFolder
    ? library.folders.map((folder) => (folder.temp ?? '').trim())
    : [];
  if (useTempFolder && tempDestinations.some((temp) => !temp)) {
    throw new AppError('Each source folder needs a temporary folder', {
      context: { operationMode },
    });
  }

  const catalog = presetCatalog(presets, library.encoder);
  const defaultPreset = catalog.find(
    (preset) => preset.id === library.defaultPresetId,
  );
  if (!defaultPreset) {
    throw new AppError('Choose a default preset for this library', {
      context: { library: library.name, encoder: library.encoder },
    });
  }

  const filterExpression = library.filters;
  const expressionProblems = validateFilterExpression(filterExpression);
  if (expressionProblems.length > 0) {
    throw new AppError('Filter rules are invalid', {
      context: { problems: expressionProblems },
    });
  }

  const defaults = library.defaults;
  return {
    sources,
    folderIds: library.folders.map((folder) => folder.id),
    destinations,
    tempDestinations,
    useTempFolder,
    filterExpression,
    copyFilteredFiles: defaults.copy_filtered_files_toggle === 1,
    copySrtFiles: defaults.copy_srt_files_toggle === 1,
    container: outputContainerExtension(library.container),
    mode: operationMode,
    presets: sources.map(() => defaultPreset.argument),
    presetCatalog: catalog,
    mappingRules: library.mappingRules,
    defaultPresetId: library.defaultPresetId,
    defaultPreset: defaultPreset.argument,
    replaceIfSmaller:
      defaults.replace_original_file_if_converted_is_smaller_toggle === 1,
    fileSuffixes: library.folders.map((folder) => folder.suffix ?? ''),
    removeApostrophes: defaults.remove_filename_apostrophes === 1,
    replaceAlways:
      defaults.replace_original_file_always_toggle === 1,
    reverseQueue: defaults.reverse_file_queue === 1,
    logDirectory,
    untrustedOutputs: unfinishedOutputs(journalPath),
  };
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
  /** Library-based run; when set, the library is the source of truth. */
  library?: Library;
  /** Full preset catalog for a library run. */
  presets?: ConversionPreset[];
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
  library,
  presets: libraryPresets = [],
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

  if (library) {
    return buildLibraryQueueConfig(
      library,
      libraryPresets,
      operationMode,
      logDirectory,
      journalPath,
    );
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
    container: outputContainerExtension(batch.container),
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
