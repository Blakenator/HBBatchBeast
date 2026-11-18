import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  fileFingerprint,
  readSplitThumbnails,
  thumbnailCacheRoot,
} from '../src/backend/organizer/split/thumbnails';

let root: string;
let video: string;
let cacheDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-thumbs-'));
  video = path.join(root, 'episode.mkv');
  fs.writeFileSync(video, 'video');
  cacheDir = path.join(root, 'cache');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('readSplitThumbnails', () => {
  it('extracts each requested time once and returns data URLs', async () => {
    const extract = vi.fn(async () => jpeg);
    const frames = await readSplitThumbnails(
      { path: video, times: [1, 1.1, 2, 60], cacheDir, maxWidth: 160 },
      { extract },
    );
    // 1 and 1.1 quantize to the same 0.25 s bucket.
    expect(extract).toHaveBeenCalledTimes(3);
    expect(frames.map((frame) => frame.seconds)).toEqual([1, 2, 60]);
    expect(frames[0].dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(
      fs.existsSync(path.join(thumbnailCacheRoot(cacheDir), fileFingerprint(video))),
    ).toBe(true);
  });

  it('serves a repeat request from the disk cache', async () => {
    const first = vi.fn(async () => jpeg);
    await readSplitThumbnails(
      { path: video, times: [5], cacheDir },
      { extract: first },
    );
    const second = vi.fn(async () => jpeg);
    const frames = await readSplitThumbnails(
      { path: video, times: [5], cacheDir },
      { extract: second },
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
  });

  it('caps one request and skips frames ffmpeg cannot read', async () => {
    const extract = vi.fn(async (_file: string, seconds: number) =>
      seconds === 2 ? undefined : jpeg,
    );
    const frames = await readSplitThumbnails(
      {
        path: video,
        times: Array.from({ length: 30 }, (_, index) => index),
        cacheDir,
        limit: 4,
      },
      { extract },
    );
    expect(extract).toHaveBeenCalledTimes(4);
    expect(frames).toHaveLength(3);
  });

  it('extracts exact scrub preview times without bucket quantization', async () => {
    const extract = vi.fn(async () => jpeg);
    const frames = await readSplitThumbnails(
      { path: video, times: [1, 1.1], cacheDir, exact: true },
      { extract },
    );
    // 1 and 1.1 share a 0.25 s bucket, but the preview must not.
    expect(extract).toHaveBeenCalledTimes(2);
    expect(frames.map((frame) => frame.seconds)).toEqual([1, 1.1]);
    // Scrub previews stay in memory instead of filling the disk cache.
    expect(fs.existsSync(thumbnailCacheRoot(cacheDir))).toBe(false);
  });

  it('returns nothing when the source is missing', async () => {
    const frames = await readSplitThumbnails(
      { path: path.join(root, 'missing.mkv'), times: [1], cacheDir },
      { extract: vi.fn(async () => jpeg) },
    );
    expect(frames).toEqual([]);
  });
});
