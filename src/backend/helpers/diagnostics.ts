import fs from 'fs';
import path from 'path';
import { DiagnosticsInfo } from '../../common';
import { AppError } from '@superflag/super-ipc-core';

/** Files the app treats as disposable caches and may delete on request. */
const CACHE_FILES = ['healthyFileList.txt', 'originalFileReplacedList.txt'];

export function diagnosticsPaths(homePath: string) {
  const root = path.join(homePath, 'Documents', 'HBBatchBeast');
  return {
    root,
    logDir: path.join(root, 'Logs'),
    configDir: path.join(root, 'Config'),
    journalPath: path.join(root, 'Config', 'run-journal.json'),
  };
}

function describe(filePath: string) {
  try {
    const stats = fs.statSync(filePath);
    return { exists: true, size: stats.size, modified: stats.mtimeMs };
  } catch {
    return { exists: false, size: 0, modified: 0 };
  }
}

export function collectDiagnostics(homePath: string): DiagnosticsInfo {
  const paths = diagnosticsPaths(homePath);

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

  return {
    logDir: paths.logDir,
    configDir: paths.configDir,
    journalPath: paths.journalPath,
    journalExists: journal.exists,
    journalStatus,
    logs,
    caches,
  };
}

export function clearCaches(homePath: string): string[] {
  const paths = diagnosticsPaths(homePath);
  const cleared: string[] = [];
  for (const name of CACHE_FILES) {
    const filePath = path.join(paths.logDir, name);
    if (!fs.existsSync(filePath)) continue;
    fs.rmSync(filePath, { force: true });
    cleared.push(name);
    // Keep the empty placeholder so the legacy modules can append to it.
    fs.writeFileSync(filePath, '', 'utf8');
  }
  return cleared;
}

export function clearRunJournal(homePath: string): void {
  const paths = diagnosticsPaths(homePath);
  fs.rmSync(paths.journalPath, { force: true });
}

/**
 * The renderer may only open folders it was told about, so a compromised
 * renderer cannot shell-open arbitrary paths.
 */
export function assertOpenablePath(homePath: string, target: string): string {
  const paths = diagnosticsPaths(homePath);
  const resolved = path.resolve(target);
  const inside = (dir: string) => {
    const base = path.resolve(dir);
    return resolved === base || resolved.startsWith(base + path.sep);
  };
  if (!inside(paths.logDir) && !inside(paths.configDir)) {
    throw new AppError('Refusing to open a path outside the app folders', {
      context: { target: resolved },
    });
  }
  return resolved;
}
