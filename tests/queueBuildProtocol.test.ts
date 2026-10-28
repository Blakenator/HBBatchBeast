import { describe, expect, it } from 'vitest';
import {
  decodeChildMessage,
  decodeParentMessage,
  decodeQueueBuildConfig,
  PROTOCOL_VERSION,
} from '../src/backend/processes/protocol';

const config = {
  sources: ['/src/a', '/src/b'],
  destinations: ['/dst/a', '/dst/b'],
  tempDestinations: [],
  useTempFolder: false,
  filterExpression: {
    version: 1,
    root: {
      id: 'root',
      kind: 'group',
      combinator: 'and',
      children: [
        {
          id: 'types',
          kind: 'rule',
          field: 'fileType',
          operator: 'isAnyOf',
          value: ['mp4', 'mkv'],
        },
        {
          id: 'output',
          kind: 'rule',
          field: 'outputState',
          operator: 'isNot',
          value: 'converted',
        },
      ],
    },
  },
  copyFilteredFiles: false,
  copySrtFiles: false,
  container: '.mp4',
  mode: 'scanAndConvert' as const,
  presets: ['-Z "Very Fast 1080p30"', '-Z "H.265 MKV 1080p30"'],
  replaceIfSmaller: false,
  fileSuffixes: ['', ''],
  removeApostrophes: false,
  replaceAlways: false,
  reverseQueue: false,
  logDirectory: '/home/user/Documents/HBBatchBeast/Logs',
  untrustedOutputs: [],
};

describe('queueBuild config codec', () => {
  it('accepts a well-formed config', () => {
    expect(decodeQueueBuildConfig(config)).toEqual({ ok: true, value: config });
  });

  it('accepts library folder ids, preset catalog and mapping rules', () => {
    const libraryConfig = {
      ...config,
      folderIds: ['folder-1', 'folder-2'],
      presetCatalog: [
        { id: 'preset-1', name: 'Default', argument: '-Z "Very Fast 1080p30"' },
        { id: 'preset-2', name: 'HD', argument: '-Z "Fast 1080p30"' },
      ],
      mappingRules: [
        {
          id: 'rule-1',
          name: 'HD',
          presetId: 'preset-2',
          condition: {
            version: 1,
            root: {
              id: 'rule-root',
              kind: 'group',
              combinator: 'and',
              children: [
                {
                  id: 'folder-rule',
                  kind: 'rule',
                  field: 'folder',
                  operator: 'is',
                  value: { folderId: 'folder-1', subpath: 'Movies' },
                },
              ],
            },
          },
        },
      ],
      defaultPresetId: 'preset-1',
      defaultPreset: '-Z "Very Fast 1080p30"',
    };

    expect(decodeQueueBuildConfig(libraryConfig)).toEqual({
      ok: true,
      value: libraryConfig,
    });
  });

  it('rejects array lengths that do not line up with sources', () => {
    const result = decodeQueueBuildConfig({
      ...config,
      presets: ['-Z "only one"'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('presets');
  });

  it('requires a temp destination for every source when staging', () => {
    expect(
      decodeQueueBuildConfig({
        ...config,
        useTempFolder: true,
        tempDestinations: ['/tmp/a'],
      }).ok,
    ).toBe(false);
  });

  it('rejects the removed healthCheck mode and unknown fields', () => {
    expect(decodeQueueBuildConfig({ ...config, mode: 'healthCheck' }).ok).toBe(
      false,
    );
    expect(decodeQueueBuildConfig({ ...config, extra: 1 }).ok).toBe(false);
  });

  it('rejects invalid filter expressions', () => {
    const result = decodeQueueBuildConfig({
      ...config,
      filterExpression: {
        version: 1,
        root: {
          id: 'root',
          kind: 'group',
          combinator: 'and',
          children: [
            {
              id: 'empty',
              kind: 'rule',
              field: 'fileType',
              operator: 'isAnyOf',
              value: [],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe('queueBuild message codecs', () => {
  it('decodes parent messages', () => {
    expect(
      decodeParentMessage({
        v: PROTOCOL_VERSION,
        type: 'configure',
        payload: config,
      }).ok,
    ).toBe(true);
    expect(
      decodeParentMessage({ v: PROTOCOL_VERSION, type: 'shutdown' }).ok,
    ).toBe(true);
    expect(
      decodeParentMessage({ v: PROTOCOL_VERSION, type: 'configure', payload: {} })
        .ok,
    ).toBe(false);
  });

  it('decodes child messages and validates the result payload', () => {
    const result = {
      total: 1,
      sources: ['/src/a.mp4'],
      presets: ['-Z "x"'],
      skipOrCopy: [0],
      excluded: [null],
      destinations: ['/dst/a.mp4'],
      destinationsFinal: [null],
      traces: [
        {
          entries: [],
          groupOutcomes: {},
          groupCombinators: {},
          groupNegates: {},
          outcome: 'included',
        },
      ],
      typeFiltered: 0,
      notExists: 1,
      presetTraces: [
        { presetId: 'preset-1', presetName: 'Default', ruleId: 'rule-1' },
      ],
    };
    expect(
      decodeChildMessage({
        v: PROTOCOL_VERSION,
        type: 'complete',
        payload: result,
      }).ok,
    ).toBe(true);
    expect(
      decodeChildMessage({
        v: PROTOCOL_VERSION,
        type: 'complete',
        payload: { ...result, total: -1 },
      }).ok,
    ).toBe(false);
    expect(
      decodeChildMessage({
        v: PROTOCOL_VERSION,
        type: 'complete',
        payload: {
          ...result,
          excluded: [{ code: 'notARealCode', reason: 'x' }],
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects stale versions and malformed progress', () => {
    expect(decodeChildMessage({ v: 2, type: 'ready' }).ok).toBe(false);
    expect(
      decodeChildMessage({
        v: PROTOCOL_VERSION,
        type: 'progress',
        phase: 'nope',
        count: 1,
      }).ok,
    ).toBe(false);
  });
});
