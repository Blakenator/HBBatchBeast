import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readBlackFrameCache,
  writeBlackFrameCache,
} from '../src/backend/organizer/split/blackFrameCache';

let root: string;
let cacheDir: string;
let source: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-black-cache-'));
  cacheDir = path.join(root, 'cache');
  source = path.join(root, 'Show', 'S01E01-E02.mkv');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, '0123456789');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('black frame cache', () => {
  it('round-trips intervals under the app cache directory', () => {
    writeBlackFrameCache(cacheDir, source, [
      { startSeconds: 10.5, endSeconds: 12.25 },
      { startSeconds: 100, endSeconds: 103 },
    ]);

    expect(readBlackFrameCache(cacheDir, source)).toEqual([
      { startSeconds: 10.5, endSeconds: 12.25 },
      { startSeconds: 100, endSeconds: 103 },
    ]);
    expect(fs.readdirSync(path.join(cacheDir, 'black-frames'))).toHaveLength(1);
  });

  it('ignores a cache entry once the file changes', () => {
    writeBlackFrameCache(cacheDir, source, [
      { startSeconds: 10, endSeconds: 12 },
    ]);
    expect(readBlackFrameCache(cacheDir, source)).toHaveLength(1);

    fs.writeFileSync(source, '01234567890');
    expect(readBlackFrameCache(cacheDir, source)).toBeUndefined();
  });

  it('ignores malformed or missing cache data', () => {
    writeBlackFrameCache(cacheDir, source, [
      { startSeconds: 10, endSeconds: 12 },
    ]);
    const [file] = fs.readdirSync(path.join(cacheDir, 'black-frames'));
    fs.writeFileSync(path.join(cacheDir, 'black-frames', file as string), 'no');

    expect(readBlackFrameCache(cacheDir, source)).toBeUndefined();
    expect(
      readBlackFrameCache(cacheDir, path.join(root, 'missing.mkv')),
    ).toBeUndefined();
  });
});
