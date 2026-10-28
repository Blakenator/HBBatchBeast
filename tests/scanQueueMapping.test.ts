import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createFilterGroup,
  createFilterRule,
  defaultFilterExpression,
} from '../src/common';
import { scanQueue } from '../src/backend/scanner/scanQueue';
import { QueueBuildConfig } from '../src/backend/processes/protocol';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-map-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string): void {
  const file = path.join(root, 'source', relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
}

function config(): QueueBuildConfig {
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  return {
    sources: [source],
    folderIds: ['folder-1'],
    destinations: [destination],
    tempDestinations: [],
    useTempFolder: false,
    filterExpression: defaultFilterExpression(),
    copyFilteredFiles: false,
    copySrtFiles: false,
    container: '.mp4',
    mode: 'scanAndConvert',
    presets: ['-Z "Default 1080p"'],
    presetCatalog: [
      { id: 'default', name: 'Default 1080p', argument: '-Z "Default 1080p"' },
      { id: 'hd', name: 'HD', argument: '-Z "Fast 1080p30"' },
    ],
    mappingRules: [
      {
        id: 'rule-hd',
        name: 'A files',
        presetId: 'hd',
        condition: {
          version: 1,
          root: createFilterGroup('and', [
            createFilterRule('fileName', 'containsAny', ['a']),
          ]),
        },
      },
    ],
    defaultPresetId: 'default',
    defaultPreset: '-Z "Default 1080p"',
    replaceIfSmaller: false,
    fileSuffixes: [''],
    removeApostrophes: false,
    replaceAlways: false,
    reverseQueue: false,
    logDirectory: path.join(root, 'logs'),
    untrustedOutputs: [],
  };
}

describe('scanQueue preset mapping', () => {
  it('resolves a preset per file and records the matched rule', async () => {
    write('a-movie.mp4');
    write('b-movie.mkv');

    const result = await scanQueue(config());
    const byName = new Map(
      result.sources.map((source, index) => [
        path.basename(source),
        {
          preset: result.presets[index],
          trace: result.presetTraces?.[index],
        },
      ]),
    );

    expect(byName.get('a-movie.mp4')).toMatchObject({
      preset: '-Z "Fast 1080p30"',
      trace: { ruleId: 'rule-hd', ruleName: 'A files' },
    });
    expect(byName.get('b-movie.mkv')).toMatchObject({
      preset: '-Z "Default 1080p"',
      trace: { presetId: 'default' },
    });
  });
});
