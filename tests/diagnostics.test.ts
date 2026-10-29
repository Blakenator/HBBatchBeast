import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AppPaths,
  appPaths,
  ensureAppFolders,
} from '../src/backend/helpers';
import {
  assertOpenablePath,
  clearCaches,
  clearRunJournal,
  collectDiagnostics,
} from '../src/backend/helpers/diagnostics';

let root: string;
let paths: AppPaths;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-diag-'));
  paths = appPaths({
    userDataPath: path.join(root, 'userData'),
    logsPath: path.join(root, 'logs'),
  });
  ensureAppFolders(paths);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('diagnostics helpers', () => {
  it('lists log files with sizes and marks cache files', () => {
    fs.writeFileSync(path.join(paths.logDir, 'ErrorLog.txt'), 'x'.repeat(2048));

    const info = collectDiagnostics(paths);

    const errorLog = info.logs.find((log) => log.name === 'ErrorLog.txt');
    expect(errorLog?.size).toBe(2048);
    expect(info.caches.map((cache) => cache.name)).toEqual([
      'healthyFileList.txt',
      'originalFileReplacedList.txt',
    ]);
    expect(info.caches.every((cache) => cache.exists)).toBe(true);
  });

  it('reports the journal status so finished runs are not called interrupted', () => {
    fs.writeFileSync(
      paths.journalPath,
      JSON.stringify({ status: 'completed', items: [] }),
    );

    expect(collectDiagnostics(paths).journalStatus).toBe('completed');
    expect(collectDiagnostics(paths).journalExists).toBe(true);
  });

  it('clears caches but leaves the placeholder files behind', () => {
    fs.writeFileSync(path.join(paths.logDir, 'healthyFileList.txt'), 'a\nb\n');

    const cleared = clearCaches(paths);

    expect(cleared).toContain('healthyFileList.txt');
    expect(
      fs.readFileSync(path.join(paths.logDir, 'healthyFileList.txt'), 'utf8'),
    ).toBe('');
  });

  it('removes the run journal on request', () => {
    fs.writeFileSync(paths.journalPath, '{}');

    clearRunJournal(paths);

    expect(fs.existsSync(paths.journalPath)).toBe(false);
  });

  it('refuses to open paths outside the app folders', () => {
    expect(
      assertOpenablePath(paths, path.join(paths.logDir, 'ErrorLog.txt')),
    ).toBe(path.join(paths.logDir, 'ErrorLog.txt'));
    expect(() => assertOpenablePath(paths, path.join(root, 'outside.txt'))).toThrow();
    expect(() => assertOpenablePath(paths, root)).toThrow();
  });
});
