import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appPaths,
  ensureAppFolders,
  legacyAppPaths,
  migrateLegacyData,
} from '../src/backend/helpers/appPaths';

let root: string;
let home: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-apppaths-'));
  home = path.join(root, 'home');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('appPaths', () => {
  it('places config and journal in userData and logs in logsPath', () => {
    const userDataPath = path.join(root, 'userData');
    const logsPath = path.join(root, 'logs');
    const paths = appPaths({ userDataPath, logsPath });

    expect(paths.configDir).toBe(path.resolve(userDataPath));
    expect(paths.configFile).toBe(
      path.join(path.resolve(userDataPath), 'Configuration.json'),
    );
    expect(paths.journalPath).toBe(
      path.join(path.resolve(userDataPath), 'run-journal.json'),
    );
    expect(paths.logDir).toBe(path.resolve(logsPath));
  });
});

describe('legacyAppPaths', () => {
  it('describes the old Documents layout', () => {
    const legacy = legacyAppPaths(home);
    const oldRoot = path.join(home, 'Documents', 'HBBatchBeast');

    expect(legacy.configDir).toBe(path.join(oldRoot, 'Config'));
    expect(legacy.configFile).toBe(
      path.join(oldRoot, 'Config', 'Configuration.json'),
    );
    expect(legacy.journalPath).toBe(
      path.join(oldRoot, 'Config', 'run-journal.json'),
    );
    expect(legacy.logDir).toBe(path.join(oldRoot, 'Logs'));
  });
});

describe('migrateLegacyData', () => {
  function makePaths() {
    return appPaths({
      userDataPath: path.join(root, 'userData'),
      logsPath: path.join(root, 'logs'),
    });
  }

  function writeLegacy() {
    const legacy = legacyAppPaths(home);
    fs.mkdirSync(legacy.configDir, { recursive: true });
    fs.mkdirSync(legacy.logDir, { recursive: true });
    fs.writeFileSync(legacy.configFile, '{"config":true}');
    fs.writeFileSync(legacy.journalPath, '{"journal":true}');
    fs.writeFileSync(path.join(legacy.logDir, 'MasterLog.txt'), 'old log');
    return legacy;
  }

  it('copies config, journal and log files when the new config is absent', () => {
    const legacy = writeLegacy();
    const current = makePaths();

    const result = migrateLegacyData(current, legacy);

    expect(result.migrated).toBe(true);
    expect(fs.readFileSync(current.configFile, 'utf8')).toBe('{"config":true}');
    expect(fs.readFileSync(current.journalPath, 'utf8')).toBe(
      '{"journal":true}',
    );
    expect(
      fs.readFileSync(path.join(current.logDir, 'MasterLog.txt'), 'utf8'),
    ).toBe('old log');
    // The legacy files stay in place.
    expect(fs.existsSync(legacy.configFile)).toBe(true);
  });

  it('does not overwrite files already present in the new layout', () => {
    const legacy = writeLegacy();
    const current = makePaths();
    fs.mkdirSync(current.configDir, { recursive: true });
    fs.writeFileSync(current.configFile, '{"new":true}');
    fs.mkdirSync(current.logDir, { recursive: true });
    fs.writeFileSync(path.join(current.logDir, 'MasterLog.txt'), 'new log');

    const result = migrateLegacyData(current, legacy);

    expect(result.migrated).toBe(false);
    expect(result.copied).toEqual([]);
    expect(fs.readFileSync(current.configFile, 'utf8')).toBe('{"new":true}');
    expect(
      fs.readFileSync(path.join(current.logDir, 'MasterLog.txt'), 'utf8'),
    ).toBe('new log');
  });

  it('is a no-op when there is no legacy data', () => {
    const current = makePaths();
    const result = migrateLegacyData(current, legacyAppPaths(home));

    expect(result.migrated).toBe(false);
    expect(result.copied).toEqual([]);
    expect(fs.existsSync(current.configFile)).toBe(false);
  });
});

describe('ensureAppFolders', () => {
  it('creates userData and logs directories with placeholder files', () => {
    const paths = appPaths({
      userDataPath: path.join(root, 'userData'),
      logsPath: path.join(root, 'logs'),
    });

    ensureAppFolders(paths);

    expect(fs.existsSync(paths.configDir)).toBe(true);
    expect(fs.existsSync(paths.logDir)).toBe(true);
    for (const name of [
      'MasterLog.txt',
      'healthyFileList.txt',
      'originalFileReplacedList.txt',
      'ErrorLog.txt',
      'fileConversionLog.txt',
      'Scans.txt',
    ]) {
      expect(fs.existsSync(path.join(paths.logDir, name)), name).toBe(true);
    }
  });
});
