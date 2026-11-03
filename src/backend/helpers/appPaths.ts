import fs from 'fs';
import path from 'path';

/**
 * Filesystem layout for app data. Config and run state live in Electron's
 * `userData` directory; logs use Electron's `logs` directory. Callers pass the
 * resolved Electron paths so these helpers stay testable outside Electron.
 */
export interface AppPaths {
  configDir: string;
  configFile: string;
  journalPath: string;
  logDir: string;
  cacheDir: string;
  backupDir: string;
}

export interface AppPathInput {
  userDataPath: string;
  logsPath: string;
  /** Optional explicit cache root; defaults under userData. */
  cachePath?: string;
}

export interface LegacyMigrationResult {
  migrated: boolean;
  copied: string[];
}

/** Log files created up front so the legacy append-only writers can rely on them. */
const PLACEHOLDER_FILES = [
  'MasterLog.txt',
  'healthyFileList.txt',
  'originalFileReplacedList.txt',
  'ErrorLog.txt',
  'fileConversionLog.txt',
  'Scans.txt',
];

export function appPaths({
  userDataPath,
  logsPath,
  cachePath,
}: AppPathInput): AppPaths {
  const configDir = path.resolve(userDataPath);
  return {
    configDir,
    configFile: path.join(configDir, 'Configuration.json'),
    journalPath: path.join(configDir, 'run-journal.json'),
    logDir: path.resolve(logsPath),
    cacheDir: path.resolve(cachePath ?? path.join(configDir, 'cache')),
    backupDir: path.join(configDir, 'backups'),
  };
}

/** The pre-2.2 layout in `~/Documents/HBBatchBeast`, used only for migration. */
export function legacyAppPaths(homePath: string): AppPaths {
  const root = path.join(homePath, 'Documents', 'HBBatchBeast');
  return {
    configDir: path.join(root, 'Config'),
    configFile: path.join(root, 'Config', 'Configuration.json'),
    journalPath: path.join(root, 'Config', 'run-journal.json'),
    logDir: path.join(root, 'Logs'),
    cacheDir: path.join(root, 'Cache'),
    backupDir: path.join(root, 'Backups'),
  };
}

export function ensureAppFolders(paths: AppPaths): void {
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.mkdirSync(paths.logDir, { recursive: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });
  fs.mkdirSync(paths.backupDir, { recursive: true });
  for (const name of PLACEHOLDER_FILES) {
    const file = path.join(paths.logDir, name);
    if (!fs.existsSync(file)) fs.appendFileSync(file, '', 'utf8');
  }
}

/**
 * Copies legacy config/journal/logs into the new layout on first launch. Files
 * already present in the new layout win, and the legacy files are never
 * removed. Only runs when the new config is still absent.
 */
export function migrateLegacyData(
  current: AppPaths,
  legacy: AppPaths,
): LegacyMigrationResult {
  const copied: string[] = [];
  if (fs.existsSync(current.configFile)) {
    return { migrated: false, copied };
  }
  if (!fs.existsSync(legacy.configDir) && !fs.existsSync(legacy.logDir)) {
    return { migrated: false, copied };
  }

  const copyIfMissing = (source: string, target: string): void => {
    if (!fs.existsSync(source) || fs.existsSync(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied.push(target);
  };

  copyIfMissing(legacy.configFile, current.configFile);
  copyIfMissing(legacy.journalPath, current.journalPath);

  try {
    if (fs.existsSync(legacy.logDir)) {
      for (const entry of fs.readdirSync(legacy.logDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        copyIfMissing(
          path.join(legacy.logDir, entry.name),
          path.join(current.logDir, entry.name),
        );
      }
    }
  } catch {
    // Legacy log migration is best effort; a locked file must not block startup.
  }

  return { migrated: copied.length > 0, copied };
}
