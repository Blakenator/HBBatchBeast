import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveFfmpegExecutable } from '../../helpers/ffmpeg';
import { mapWithConcurrency } from '../concurrency';

export interface SplitThumbnailFrame {
  seconds: number;
  dataUrl: string;
}

export interface SplitThumbnailRequest {
  path: string;
  times: readonly number[];
  cacheDir: string;
  maxWidth?: number;
  /** Upper bound for one request; protects the IPC payload. */
  limit?: number;
  /**
   * Extract exactly at each requested time. The filmstrip accepts the 0.25 s
   * cache bucket, but the scrub preview must show the frame at the playhead.
   */
  exact?: boolean;
}

export interface SplitThumbnailDeps {
  ffmpegPath?: string;
  /** Test hook; returns raw JPEG bytes instead of spawning ffmpeg. */
  extract?: (filePath: string, seconds: number, maxWidth: number) => Promise<Buffer | undefined>;
}

const MAX_REQUEST_FRAMES = 16;
const MAX_CACHE_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_CACHE_FILES = 20_000;
const QUANTUM_SECONDS = 0.25;
const memoryCache = new Map<string, string>();
const MEMORY_CACHE_LIMIT = 400;
let lastPruneAt = 0;

export function thumbnailCacheRoot(cacheDir: string): string {
  return path.join(cacheDir, 'split-thumbs');
}

export function fileFingerprint(filePath: string): string {
  const stat = fs.statSync(filePath);
  return crypto
    .createHash('sha1')
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}`)
    .digest('hex');
}

function quantize(seconds: number): number {
  return Math.max(0, Math.round(seconds / QUANTUM_SECONDS) * QUANTUM_SECONDS);
}

function cacheFile(
  cacheDir: string,
  fingerprint: string,
  seconds: number,
  maxWidth: number,
): string {
  return path.join(
    thumbnailCacheRoot(cacheDir),
    fingerprint,
    `${Math.round(seconds * 1000)}-${maxWidth}.jpg`,
  );
}

function remember(key: string, dataUrl: string): void {
  memoryCache.set(key, dataUrl);
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

/** Best-effort cache pruning; runs at most daily. */
export function pruneThumbnailCache(cacheDir: string, now = Date.now()): void {
  if (now - lastPruneAt < 24 * 60 * 60 * 1000) return;
  lastPruneAt = now;
  const root = thumbnailCacheRoot(cacheDir);
  try {
    const folders = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const folder = path.join(root, entry.name);
        try {
          const stat = fs.statSync(folder);
          return { folder, modified: stat.mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is { folder: string; modified: number } =>
        Boolean(entry),
      )
      .sort((left, right) => left.modified - right.modified);
    const removed = folders.filter(
      (entry) => now - entry.modified > MAX_CACHE_AGE_MS,
    );
    for (const entry of removed) {
      fs.rmSync(entry.folder, { recursive: true, force: true });
    }
    let fileCount = 0;
    for (const entry of folders) {
      if (!fs.existsSync(entry.folder)) continue;
      fileCount += fs.readdirSync(entry.folder).length;
    }
    if (fileCount > MAX_CACHE_FILES) {
      for (const entry of folders) {
        if (!fs.existsSync(entry.folder)) continue;
        const count = fs.readdirSync(entry.folder).length;
        fs.rmSync(entry.folder, { recursive: true, force: true });
        fileCount -= count;
        if (fileCount <= MAX_CACHE_FILES) break;
      }
    }
  } catch {
    // A missing or partially removed cache is fine.
  }
}

/** Extracts one frame as JPEG bytes; `-ss` before `-i` keeps it fast. */
export function extractThumbnailJpeg(
  filePath: string,
  seconds: number,
  maxWidth: number,
  ffmpegPath = resolveFfmpegExecutable(),
): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-ss',
        seconds.toFixed(3),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${maxWidth},iw)':-2`,
        '-q:v',
        '5',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      {
        encoding: 'buffer',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error || !stdout || stdout.length === 0) {
          resolve(undefined);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function thumbnailFor(
  filePath: string,
  cacheDir: string,
  fingerprint: string,
  seconds: number,
  maxWidth: number,
  deps: SplitThumbnailDeps,
  persist: boolean,
): Promise<SplitThumbnailFrame | undefined> {
  const file = cacheFile(cacheDir, fingerprint, seconds, maxWidth);
  const key = file;
  const cached = memoryCache.get(key);
  if (cached) return { seconds, dataUrl: cached };
  try {
    const data = fs.readFileSync(file);
    if (data.length > 0) {
      const dataUrl = `data:image/jpeg;base64,${data.toString('base64')}`;
      remember(key, dataUrl);
      return { seconds, dataUrl };
    }
  } catch {
    // Not cached yet.
  }
  const extract =
    deps.extract ??
    ((target: string, at: number, width: number) =>
      extractThumbnailJpeg(target, at, width, deps.ffmpegPath));
  const buffer = await extract(filePath, seconds, maxWidth);
  if (!buffer || buffer.length === 0) return undefined;
  // Exact scrub frames are one-off; keeping them in memory avoids filling the
  // disk cache with every sub-second position the playhead passed.
  if (persist) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, buffer);
      fs.renameSync(`${file}.tmp`, file);
    } catch {
      // A cache failure must never block the filmstrip.
    }
  }
  const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  remember(key, dataUrl);
  return { seconds, dataUrl };
}

/** Reads frames for the current filmstrip window, nearest-second cached. */
export async function readSplitThumbnails(
  request: SplitThumbnailRequest,
  deps: SplitThumbnailDeps = {},
): Promise<SplitThumbnailFrame[]> {
  const maxWidth = Math.max(48, Math.min(640, request.maxWidth ?? 160));
  const limit = Math.max(1, Math.min(MAX_REQUEST_FRAMES, request.limit ?? 12));
  const unique = [
    ...new Set(
      request.times
        .filter((seconds) => Number.isFinite(seconds) && seconds >= 0)
        .map((seconds) =>
          request.exact
            ? Math.round(seconds * 1000) / 1000
            : quantize(seconds),
        ),
    ),
  ].slice(0, limit);
  if (unique.length === 0) return [];
  let fingerprint: string;
  try {
    fingerprint = fileFingerprint(request.path);
  } catch {
    return [];
  }
  pruneThumbnailCache(request.cacheDir);
  const frames = await mapWithConcurrency(unique, 2, (seconds) =>
    thumbnailFor(
      request.path,
      request.cacheDir,
      fingerprint,
      seconds,
      maxWidth,
      deps,
      request.exact !== true,
    ),
  );
  return frames.filter((frame): frame is SplitThumbnailFrame => Boolean(frame));
}
