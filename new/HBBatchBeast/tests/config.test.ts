import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogFolders, saveAppConfig } from '../src/backend/helpers';
import { GlobalAppConfig } from '../src/common';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-config-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('createLogFolders', () => {
  it('creates the documents, config and log layout the child modules expect', () => {
    createLogFolders(home);

    const expectedDirectories = [
      'Documents/HBBatchBeast',
      'Documents/HBBatchBeast/Config',
      'Documents/HBBatchBeast/Config/Processes',
      'Documents/HBBatchBeast/Config/Processes/WorkerStatus',
      'Documents/HBBatchBeast/Config/Processes/WorkerStatus/Console',
      'Documents/HBBatchBeast/Config/Processes/WorkerStatus/ErrorLogs',
      'Documents/HBBatchBeast/Logs',
    ];
    for (const directory of expectedDirectories) {
      expect(fs.existsSync(path.join(home, directory)), directory).toBe(true);
    }

    const expectedLogFiles = [
      'MasterLog.txt',
      'healthyFileList.txt',
      'originalFileReplacedList.txt',
      'ErrorLog.txt',
      'fileConversionLog.txt',
      'Scans.txt',
    ];
    for (const file of expectedLogFiles) {
      expect(
        fs.existsSync(path.join(home, 'Documents/HBBatchBeast/Logs', file)),
        file,
      ).toBe(true);
    }
  });

  it('works on a fresh home directory without an existing Documents folder', () => {
    // `home` is an empty mkdtemp dir here; D18 used to make this throw ENOENT
    expect(fs.existsSync(path.join(home, 'Documents'))).toBe(false);

    createLogFolders(home);

    expect(
      fs.existsSync(path.join(home, 'Documents/HBBatchBeast/Logs')),
    ).toBe(true);
  });

  it('is idempotent and preserves existing log contents', () => {
    createLogFolders(home);
    const masterLog = path.join(
      home,
      'Documents/HBBatchBeast/Logs/MasterLog.txt',
    );
    fs.writeFileSync(masterLog, 'existing entry', 'utf8');

    createLogFolders(home);

    expect(fs.readFileSync(masterLog, 'utf8')).toBe('existing entry');
  });
});

describe('saveAppConfig', () => {
  it('writes the config as formatted JSON that round-trips', () => {
    createLogFolders(home);
    const configPath = path.join(
      home,
      'Documents/HBBatchBeast/Config/Configuration.json',
    );
    const config: GlobalAppConfig = {
      lang: 'en',
      selected_config: 0,
      version_message: '2.1.5',
      api_key: '',
      configs: [
        {
          name: 'Default',
          tab_batch: {},
          tab_health: {},
          tab_remote: {},
          tab_system: {},
        },
      ],
    };

    saveAppConfig(configPath, config);

    const raw = fs.readFileSync(configPath, 'utf8');
    expect(raw).toContain('\n  "lang": "en"');
    expect(JSON.parse(raw)).toEqual(config);
  });

  it('throws an AppError when the target directory does not exist', () => {
    const missing = path.join(home, 'nope/Configuration.json');

    expect(() =>
      saveAppConfig(missing, { configs: [] } as unknown as GlobalAppConfig),
    ).toThrow(/Error persisting new app config/);
  });
});
