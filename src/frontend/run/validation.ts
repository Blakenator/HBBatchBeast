import { BatchTabConfig } from '../../common';

function lines(value?: string): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const isInside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(`${parent}/`) || child.startsWith(`${parent}\\`);

/** Blocking problems that must be fixed before a run may start. */
export function validateBatchConfig(
  batch: Partial<BatchTabConfig> = {},
): string[] {
  const problems: string[] = [];
  const paths: Partial<BatchTabConfig['path']> = batch.path ?? {};
  const sources = lines(paths.source_path);
  const destinations = lines(paths.destination_path);
  const tempEnabled = paths.temp_toggle === 1;
  const tempDestinations = lines(paths.temp_destination_path);

  if (sources.length === 0) {
    problems.push('Add at least one source folder.');
  }
  if (destinations.length === 0) {
    problems.push('Add at least one destination folder.');
  }
  if (sources.length > 0 && destinations.length > 0 && sources.length !== destinations.length) {
    problems.push(
      `${sources.length} source folder(s) but ${destinations.length} destination folder(s) — they must match.`,
    );
  }
  if (tempEnabled && tempDestinations.length !== sources.length) {
    problems.push(
      `Temp staging is on: ${sources.length} source folder(s) need ${sources.length} temp folder(s), found ${tempDestinations.length}.`,
    );
  }
  sources.forEach((source, index) => {
    const destination = destinations[index];
    if (destination && isInside(destination, source)) {
      problems.push(
        `Destination ${destination} is inside source ${source}; choose a folder outside it.`,
      );
    }
  });

  const suffixes = (batch.advanced?.file_name_suffix ?? '')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (
    batch.advanced?.file_name_suffix_toggle === 1 &&
    suffixes.length > 0 &&
    suffixes.length < sources.length
  ) {
    problems.push(
      `${suffixes.length} filename suffix(es) for ${sources.length} source folder(s); missing rows fall back to none.`,
    );
  }

  return problems;
}
