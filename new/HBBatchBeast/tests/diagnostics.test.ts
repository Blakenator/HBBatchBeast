import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assertOpenablePath,
  clearCaches,
  clearRunJournal,
  collectDiagnostics,
  diagnosticsPaths,
} from '../src/backend/helpers/diagnostics';
import { createLogFolders } from '../src/backend/helpers';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-diag-'));
  createLogFolders(home);
  return home;
}

describe('diagnostics helpers', () => {
  it('lists log files with sizes and marks cache files', () => {
    const home = makeHome();
    const paths = diagnosticsPaths(home);
    fs.writeFileSync(path.join(paths.logDir, 'ErrorLog.txt'), 'x'.repeat(2048));

    const info = collectDiagnostics(home);

    const errorLog = info.logs.find((log) => log.name === 'ErrorLog.txt');
    expect(errorLog?.size).toBe(2048);
    expect(info.caches.map((cache) => cache.name)).toEqual([
      'healthyFileList.txt',
      'originalFileReplacedList.txt',
    ]);
    expect(info.caches.every((cache) => cache.exists)).toBe(true);
  });

  it('reports the journal status so finished runs are not called interrupted', () => {
    const home = makeHome();
    const paths = diagnosticsPaths(home);
    fs.writeFileSync(
      paths.journalPath,
      JSON.stringify({ status: 'completed', items: [] }),
    );

    expect(collectDiagnostics(home).journalStatus).toBe('completed');
    expect(collectDiagnostics(home).journalExists).toBe(true);
  });

  it('clears caches but leaves the placeholder files behind', () => {
    const home = makeHome();
    const paths = diagnosticsPaths(home);
    fs.writeFileSync(path.join(paths.logDir, 'healthyFileList.txt'), 'a\nb\n');

    const cleared = clearCaches(home);

    expect(cleared).toContain('healthyFileList.txt');
    expect(
      fs.readFileSync(path.join(paths.logDir, 'healthyFileList.txt'), 'utf8'),
    ).toBe('');
  });

  it('removes the run journal on request', () => {
    const home = makeHome();
    const paths = diagnosticsPaths(home);
    fs.writeFileSync(paths.journalPath, '{}');

    clearRunJournal(home);

    expect(fs.existsSync(paths.journalPath)).toBe(false);
  });

  it('refuses to open paths outside the app folders', () => {
    const home = makeHome();
    const paths = diagnosticsPaths(home);

    expect(assertOpenablePath(home, path.join(paths.logDir, 'ErrorLog.txt'))).toBe(
      path.join(paths.logDir, 'ErrorLog.txt'),
    );
    expect(() => assertOpenablePath(home, '/etc/passwd')).toThrow();
    expect(() => assertOpenablePath(home, path.join(home, 'Documents'))).toThrow();
  });
});
