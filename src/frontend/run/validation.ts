import {
  BatchTabConfig,
  HANDBRAKE_CONTAINERS,
  normalizeContainerExtension,
  parseMappedRows,
  resolveFilterExpression,
  validateFilterExpression,
} from '../../common';

const trimTrailingSeparators = (value: string) => value.replace(/[\\/]+$/, '');

export function isInside(child: string, parent: string): boolean {
  const childPath = trimTrailingSeparators(child);
  const parentPath = trimTrailingSeparators(parent);
  return (
    childPath === parentPath ||
    childPath.startsWith(`${parentPath}/`) ||
    childPath.startsWith(`${parentPath}\\`)
  );
}

/** Blocking problems that must be fixed before a run may start. */
export function validateBatchConfig(
  batch: Partial<BatchTabConfig> = {},
): string[] {
  const problems: string[] = [];
  const paths: Partial<BatchTabConfig['path']> = batch.path ?? {};
  const advanced: Partial<BatchTabConfig['advanced']> = batch.advanced ?? {};

  const sources = parseMappedRows(paths.source_path);
  const destinations = parseMappedRows(paths.destination_path);
  const sourceCount = sources.filter(Boolean).length;
  const destinationCount = destinations.filter(Boolean).length;
  const tempEnabled = paths.temp_toggle === 1;
  const tempDestinations = tempEnabled
    ? parseMappedRows(paths.temp_destination_path)
    : [];

  if (sourceCount === 0) {
    problems.push('Add at least one source folder.');
  }
  if (destinationCount === 0) {
    problems.push('Add at least one destination folder.');
  }

  const pairedRows = Math.max(sources.length, destinations.length);
  for (let index = 0; index < pairedRows; index += 1) {
    const source = sources[index] ?? '';
    const destination = destinations[index] ?? '';
    if (source && !destination) {
      problems.push(`Row ${index + 1}: add a destination folder for ${source}.`);
    } else if (!source && destination) {
      problems.push(`Row ${index + 1}: add a source folder for ${destination}.`);
    } else if (source && destination && isInside(destination, source)) {
      problems.push(
        `Row ${index + 1}: destination ${destination} is inside source ${source}; choose a folder outside it.`,
      );
    }
  }

  if (
    sourceCount > 0 &&
    destinationCount > 0 &&
    sourceCount !== destinationCount
  ) {
    // The per-row checks above already name the incomplete row; only add a
    // summary when the counts differ for a reason they do not explain.
    const unexplained =
      Math.max(sources.length, destinations.length) <=
      Math.min(sourceCount, destinationCount);
    if (unexplained) {
      problems.push(
        `${sourceCount} source folder(s) but ${destinationCount} destination folder(s) — they must match.`,
      );
    }
  }

  if (tempEnabled) {
    const tempRows = Math.max(sources.length, tempDestinations.length);
    for (let index = 0; index < tempRows; index += 1) {
      const source = sources[index] ?? '';
      const temp = tempDestinations[index] ?? '';
      if (source && !temp) {
        problems.push(`Row ${index + 1}: add a temp folder for ${source}.`);
      } else if (!source && temp) {
        problems.push(`Row ${index + 1}: add a source folder for ${temp}.`);
      }
    }
  }

  const ffmpegMode = batch.FFmpeg_toggle === 1;
  const container = normalizeContainerExtension(batch.container);
  if (
    !ffmpegMode &&
    container &&
    !(HANDBRAKE_CONTAINERS as readonly string[]).includes(container)
  ) {
    problems.push(
      `HandBrake cannot write ${container} files; choose MP4, M4V, or MKV.`,
    );
  }

  const customRows = parseMappedRows(batch.custom_preset_string);
  const hasCustomRows = customRows.some((row) => row.trim().length > 0);
  const presetRows = ffmpegMode
    ? customRows
    : hasCustomRows
      ? customRows
      : parseMappedRows(batch.preset);
  const configuredPresets = presetRows.filter(Boolean).length;

  if (sourceCount > 0 && configuredPresets === 0) {
    problems.push(
      ffmpegMode
        ? 'Add FFmpeg arguments for each source folder.'
        : 'Choose a HandBrake preset for each source folder.',
    );
  } else {
    for (let index = 0; index < sourceCount; index += 1) {
      const hasLaterPreset = presetRows
        .slice(index + 1)
        .some((row) => row.trim().length > 0);
      if (!(presetRows[index] ?? '').trim() && hasLaterPreset) {
        problems.push(`Folder ${index + 1} is missing a preset or arguments.`);
      }
    }
  }

  if (advanced.file_name_suffix_toggle === 1 && sourceCount > 0) {
    const suffixes = parseMappedRows(advanced.file_name_suffix);
    for (let index = 0; index < sourceCount; index += 1) {
      const hasLaterSuffix = suffixes
        .slice(index + 1)
        .some((row) => row.trim().length > 0);
      if (!(suffixes[index] ?? '').trim() && hasLaterSuffix) {
        problems.push(`Folder ${index + 1} is missing its filename suffix.`);
      }
    }
  }

  for (const problem of validateFilterExpression(
    resolveFilterExpression(advanced),
  )) {
    problems.push(`Filters: ${problem}`);
  }

  return problems;
}
