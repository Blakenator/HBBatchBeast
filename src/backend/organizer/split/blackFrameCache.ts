import fs from 'fs';
import path from 'path';
import type { SplitBlackInterval } from '../../../common/organizer/split';
import { fileFingerprint } from './thumbnails';

/**
 * Cached `blackdetect` results, keyed by file path, size and mtime. A scan
 * decodes the whole file, so the result is kept under the app cache directory
 * and reused when the split editor is opened again.
 */

const CACHE_VERSION = 1;
const MAX_CACHE_FILES = 5_000;

interface StoredBlackFrames {
  version: number;
  scannedAt: number;
  intervals: SplitBlackInterval[];
}

function cacheRoot(cacheDir: string): string {
  return path.join(cacheDir, 'black-frames');
}

function cacheFile(cacheDir: string, filePath: string): string | undefined {
  try {
    return path.join(cacheRoot(cacheDir), `${fileFingerprint(filePath)}.json`);
  } catch {
    // A missing or unreadable source cannot have a useful cache entry.
    return undefined;
  }
}

function isInterval(value: unknown): value is SplitBlackInterval {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SplitBlackInterval>;
  return (
    Number.isFinite(candidate.startSeconds) &&
    Number.isFinite(candidate.endSeconds) &&
    (candidate.endSeconds as number) > (candidate.startSeconds as number)
  );
}

/** Reads saved black runs for a file; `undefined` when nothing is cached. */
export function readBlackFrameCache(
  cacheDir: string,
  filePath: string,
): SplitBlackInterval[] | undefined {
  const file = cacheFile(cacheDir, filePath);
  if (!file) return undefined;
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as
      | Partial<StoredBlackFrames>
      | undefined;
    if (
      stored?.version !== CACHE_VERSION ||
      !Array.isArray(stored.intervals) ||
      !stored.intervals.every(isInterval)
    ) {
      return undefined;
    }
    return stored.intervals;
  } catch {
    return undefined;
  }
}

/** Stores the result of a black-frame scan, replacing any older result. */
export function writeBlackFrameCache(
  cacheDir: string,
  filePath: string,
  intervals: readonly SplitBlackInterval[],
): void {
  const file = cacheFile(cacheDir, filePath);
  if (!file) return;
  const stored: StoredBlackFrames = {
    version: CACHE_VERSION,
    scannedAt: Date.now(),
    intervals: intervals.map((interval) => ({
      startSeconds: interval.startSeconds,
      endSeconds: interval.endSeconds,
    })),
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored));
    pruneBlackFrameCache(cacheDir);
  } catch {
    // The cache is best-effort; the scan result is still returned to the UI.
  }
}

/**
 * Keeps the cache bounded. Runs only when a new scan is stored, so the cost is
 * one directory read per scan rather than one per lookup.
 */
export function pruneBlackFrameCache(cacheDir: string): void {
  const root = cacheRoot(cacheDir);
  let entries: { file: string; modified: number }[];
  try {
    entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const file = path.join(root, entry.name);
        try {
          return { file, modified: fs.statSync(file).mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is { file: string; modified: number } =>
        Boolean(entry),
      )
      .sort((left, right) => left.modified - right.modified);
  } catch {
    return;
  }
  const excess = entries.length - MAX_CACHE_FILES;
  if (excess <= 0) return;
  for (const entry of entries.slice(0, excess)) {
    try {
      fs.rmSync(entry.file, { force: true });
    } catch {
      // Another process may have removed it already.
    }
  }
}
