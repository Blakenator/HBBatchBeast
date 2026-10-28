import {
  joinOutputPath,
  outputContainerExtension,
  outputRelativePath,
} from '../../common';

/** Illustrative path shown under a row until a scan reveals real files. */
export const EXAMPLE_RELATIVE_PATH = 'Show Name/Season 01/Episode 01.mkv';

export interface FolderRowPreview {
  /** Illustrative source path, relative to the source folder. */
  sample: string;
  /** Full output path shown to the user. */
  output: string;
}

interface PreviewOptions {
  destination: string;
  suffix?: string;
  container?: string;
  sample?: string;
}

/**
 * Mirrors how `scanQueue` maps a source-relative path, so the settings preview
 * cannot promise a layout the conversion does not produce.
 */
export function folderRowPreview({
  destination,
  suffix = '',
  container,
  sample = EXAMPLE_RELATIVE_PATH,
}: PreviewOptions): FolderRowPreview | null {
  if (destination.trim().length === 0) return null;
  const relative = outputRelativePath(
    sample,
    suffix,
    outputContainerExtension(container),
  );
  return { sample, output: joinOutputPath(destination, relative) };
}

/** Compares destinations the way the OS would: case-insensitive on Windows. */
function destinationKey(destination: string): string {
  const trimmed = destination.trim().replace(/[\\/]+$/, '');
  return trimmed.includes('\\') ? trimmed.toLowerCase() : trimmed;
}

/**
 * Maps each row index to the other rows (0-based) sharing its destination.
 * Rows without a destination are ignored.
 */
export function sharedDestinationRows(
  destinations: readonly string[],
): Map<number, number[]> {
  const groups = new Map<string, number[]>();
  destinations.forEach((destination, index) => {
    const key = destinationKey(destination);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const shared = new Map<number, number[]>();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (const index of rows) {
      shared.set(
        index,
        rows.filter((other) => other !== index),
      );
    }
  }
  return shared;
}
