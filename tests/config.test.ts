import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AppPaths,
  appPaths,
  ensureAppFolders,
  saveAppConfig,
} from '../src/backend/helpers';
import { GlobalAppConfig } from '../src/common';

let root: string;
let paths: AppPaths;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-config-'));
  paths = appPaths({
    userDataPath: path.join(root, 'userData'),
    logsPath: path.join(root, 'logs'),
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensureAppFolders', () => {
  it('creates the userData/logs layout the child modules expect', () => {
    ensureAppFolders(paths);

    expect(fs.existsSync(paths.configDir)).toBe(true);
    expect(fs.existsSync(paths.logDir)).toBe(true);

    const expectedLogFiles = [
      'MasterLog.txt',
      'healthyFileList.txt',
      'originalFileReplacedList.txt',
      'ErrorLog.txt',
      'fileConversionLog.txt',
      'Scans.txt',
    ];
    for (const file of expectedLogFiles) {
      expect(fs.existsSync(path.join(paths.logDir, file)), file).toBe(true);
    }
  });

  it('works when the parent directories do not exist yet', () => {
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(paths.logDir)).toBe(false);

    ensureAppFolders(paths);

    expect(fs.existsSync(paths.logDir)).toBe(true);
  });

  it('is idempotent and preserves existing log contents', () => {
    ensureAppFolders(paths);
    const masterLog = path.join(paths.logDir, 'MasterLog.txt');
    fs.writeFileSync(masterLog, 'existing entry', 'utf8');

    ensureAppFolders(paths);

    expect(fs.readFileSync(masterLog, 'utf8')).toBe('existing entry');
  });
});

describe('saveAppConfig', () => {
  it('writes the config as formatted JSON that round-trips', () => {
    ensureAppFolders(paths);
    const config: GlobalAppConfig = {
      lang: 'en',
      selected_config: 0,
      version_message: '2.1.5',
      configs: [
        {
          name: 'Default',
          tab_batch: {},
          tab_system: {},
        },
      ],
    };

    saveAppConfig(paths.configFile, config);

    const raw = fs.readFileSync(paths.configFile, 'utf8');
    expect(raw).toContain('\n  "lang": "en"');
    expect(JSON.parse(raw)).toEqual(config);
  });

  it('throws an AppError when the target directory does not exist', () => {
    const missing = path.join(root, 'nope/Configuration.json');

    expect(() =>
      saveAppConfig(missing, { configs: [] } as unknown as GlobalAppConfig),
    ).toThrow(/Error persisting new app config/);
  });
});
