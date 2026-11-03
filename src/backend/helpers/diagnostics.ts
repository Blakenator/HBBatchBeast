import fs from 'fs';
import path from 'path';
import { DiagnosticsInfo } from '../../common';
import { AppError } from '@superflag/super-ipc-core';
import { AppPaths } from './appPaths';

/** Files the app treats as disposable caches and may delete on request. */
const CACHE_FILES = ['healthyFileList.txt', 'originalFileReplacedList.txt'];

function describe(filePath: string) {
  try {
    const stats = fs.statSync(filePath);
    return { exists: true, size: stats.size, modified: stats.mtimeMs };
  } catch {
    return { exists: false, size: 0, modified: 0 };
  }
}

function listBackups(
  backupDir: string,
): { name: string; path: string; size: number }[] {
  try {
    return fs
      .readdirSync(backupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(backupDir, entry.name);
        return {
          name: entry.name,
          path: filePath,
          size: describe(filePath).size,
        };
      })
      .sort((left, right) => right.name.localeCompare(left.name));
  } catch {
    return [];
  }
}

export function collectDiagnostics(paths: AppPaths): DiagnosticsInfo {
  const logs: DiagnosticsInfo['logs'] = [];
  if (fs.existsSync(paths.logDir)) {
    for (const entry of fs.readdirSync(paths.logDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(paths.logDir, entry.name);
      const info = describe(filePath);
      logs.push({ name: entry.name, path: filePath, size: info.size });
    }
  }
  logs.sort((a, b) => a.name.localeCompare(b.name));

  const caches: DiagnosticsInfo['caches'] = CACHE_FILES.map((name) => {
    const filePath = path.join(paths.logDir, name);
    const info = describe(filePath);
    return { name, path: filePath, size: info.size, exists: info.exists };
  });

  const journal = describe(paths.journalPath);
  let journalStatus: string | undefined;
  if (journal.exists) {
    try {
      journalStatus = (JSON.parse(fs.readFileSync(paths.journalPath, 'utf8')) as {
        status?: string;
      }).status;
    } catch {
      journalStatus = undefined;
    }
  }

  const organizerJournalPath = path.join(
    paths.configDir,
    'organize-journal.json',
  );
  const pendingPath = path.join(paths.configDir, 'organize-pending.json');
  let pendingTransfers = 0;
  try {
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8')) as unknown;
    if (Array.isArray(pending)) pendingTransfers = pending.length;
  } catch {
    // No pending file yet.
  }
  const tvdbCacheDir = path.join(paths.cacheDir, 'tvdb');
  let tvdbCacheFiles = 0;
  try {
    tvdbCacheFiles = fs
      .readdirSync(tvdbCacheDir, { withFileTypes: true })
      .filter((entry) => entry.isFile()).length;
  } catch {
    // No TVDB cache yet.
  }
  const backups = listBackups(paths.backupDir);

  return {
    logDir: paths.logDir,
    configDir: paths.configDir,
    journalPath: paths.journalPath,
    journalExists: journal.exists,
    journalStatus,
    logs,
    caches,
    organizer: {
      journalPath: organizerJournalPath,
      journalExists: fs.existsSync(organizerJournalPath),
      pendingPath,
      pendingTransfers,
      backupDir: paths.backupDir,
      backups,
      tvdbCacheDir,
      tvdbCacheFiles,
    },
  };
}

export function clearCaches(paths: AppPaths): string[] {
  const cleared: string[] = [];
  for (const name of CACHE_FILES) {
    const filePath = path.join(paths.logDir, name);
    if (!fs.existsSync(filePath)) continue;
    fs.rmSync(filePath, { force: true });
    cleared.push(name);
    // Keep the empty placeholder so the legacy modules can append to it.
    fs.writeFileSync(filePath, '', 'utf8');
  }
  const tvdbCacheDir = path.join(paths.cacheDir, 'tvdb');
  try {
    for (const entry of fs.readdirSync(tvdbCacheDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      fs.rmSync(path.join(tvdbCacheDir, entry.name), { force: true });
    }
    cleared.push('TVDB cache');
  } catch {
    // A missing cache folder means there is nothing to clear.
  }
  return cleared;
}

export function clearRunJournal(paths: AppPaths): void {
  fs.rmSync(paths.journalPath, { force: true });
}

/**
 * The renderer may only open folders it was told about, so a compromised
 * renderer cannot shell-open arbitrary paths.
 */
export function assertOpenablePath(paths: AppPaths, target: string): string {
  const resolved = path.resolve(target);
  const inside = (dir: string) => {
    const base = path.resolve(dir);
    return resolved === base || resolved.startsWith(base + path.sep);
  };
  if (
    !inside(paths.logDir) &&
    !inside(paths.configDir) &&
    !inside(paths.cacheDir) &&
    !inside(paths.backupDir)
  ) {
    throw new AppError('Refusing to open a path outside the app folders', {
      context: { target: resolved },
    });
  }
  return resolved;
}
