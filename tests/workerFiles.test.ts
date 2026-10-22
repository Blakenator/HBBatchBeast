import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appendLog,
  copyFile,
  formatLogTimestamp,
  moveFile,
  pathExists,
  replaceOriginalFile,
  statSize,
  withSourceExtension,
} from '../src/backend/workers/files';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-worker-files-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('log formatting', () => {
  it('matches the legacy timestamp shape', () => {
    expect(
      formatLogTimestamp(new Date(2026, 9, 1, 9, 5, 7)),
    ).toBe('01-October-2026#09:05:07');
  });

  it('appends into a missing nested directory', async () => {
    const directory = path.join(root, 'a', 'b');
    await appendLog(directory, 'ErrorLog.txt', 'line\n');
    expect(fs.readFileSync(path.join(directory, 'ErrorLog.txt'), 'utf8')).toBe(
      'line\n',
    );
  });
});

describe('destination naming', () => {
  it('keeps the source extension for passthrough copies', () => {
    expect(withSourceExtension('/out/a.mp4', '/src/a.mkv')).toBe('/out/a.mkv');
    expect(withSourceExtension('/out/a.mp4', '/src/a.mp4')).toBe('/out/a.mp4');
    expect(withSourceExtension('/out/a', '/src/a.mkv')).toBe('/out/a.mkv');
    expect(withSourceExtension('/out/a.mp4', '/src/README')).toBe('/out/a.mp4');
  });
});

describe('file operations', () => {
  it('copies, moves, stats and reports existence', async () => {
    const source = path.join(root, 'source.txt');
    fs.writeFileSync(source, 'hello');

    const copy = path.join(root, 'nested', 'copy.txt');
    await copyFile(source, copy);
    expect(await statSize(copy)).toBe(5);
    expect(await pathExists(copy)).toBe(true);

    const moved = path.join(root, 'moved', 'moved.txt');
    await moveFile(copy, moved);
    expect(await pathExists(copy)).toBe(false);
    expect(fs.readFileSync(moved, 'utf8')).toBe('hello');
    expect(await statSize(path.join(root, 'nope'))).toBeUndefined();
  });

  it('replaces the original in place', async () => {
    const original = path.join(root, 'source', 'clip.mp4');
    const converted = path.join(root, 'out', 'clip.mp4');
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.mkdirSync(path.dirname(converted), { recursive: true });
    fs.writeFileSync(original, 'old and large');
    fs.writeFileSync(converted, 'new');

    const target = await replaceOriginalFile(original, converted);

    expect(target).toBe(original);
    expect(fs.readFileSync(original, 'utf8')).toBe('new');
    expect(fs.existsSync(converted)).toBe(false);
  });
});
