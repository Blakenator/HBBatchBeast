import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  FilterExpression,
  createFilterGroup,
  createFilterRule,
} from '../src/common/filterExpression';
import {
  destinationPath,
  outputRelativePath,
} from '../src/backend/scanner/destination';
import { scanQueue } from '../src/backend/scanner/scanQueue';
import { QueueBuildConfig } from '../src/backend/processes/protocol';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-scan-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

interface ExpressionOptions {
  fileTypes?: string[];
  titleWords?: string[];
  includeConverted?: boolean;
  minMb?: number;
  maxMb?: number;
  mediaProperty?: {
    operator: 'equals' | 'notEquals' | 'contains' | 'gt' | 'lt';
    key: string;
    value: string;
  };
}

function expression(options: ExpressionOptions = {}): FilterExpression {
  const children = [
    createFilterRule(
      'fileType',
      'isAnyOf',
      options.fileTypes ?? ['mp4', 'mkv', 'srt'],
    ),
  ];
  if (!options.includeConverted) {
    children.push(createFilterRule('outputState', 'isNot', 'converted'));
  }
  if (options.titleWords?.length) {
    children.push(createFilterRule('fileName', 'containsNone', options.titleWords));
  }
  if (options.minMb !== undefined) {
    children.push(createFilterRule('fileSize', 'atLeast', options.minMb));
  }
  if (options.maxMb !== undefined) {
    children.push(createFilterRule('fileSize', 'atMost', options.maxMb));
  }
  if (options.mediaProperty) {
    children.push(
      createFilterRule('mediaProperty', options.mediaProperty.operator, {
        key: options.mediaProperty.key,
        value: options.mediaProperty.value,
      }),
    );
  }
  return { version: 1, root: createFilterGroup('and', children) };
}

function config(overrides: Partial<QueueBuildConfig> = {}): QueueBuildConfig {
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  return {
    sources: [source],
    destinations: [destination],
    tempDestinations: [],
    useTempFolder: false,
    filterExpression: expression(),
    copyFilteredFiles: false,
    copySrtFiles: true,
    container: '.mp4',
    mode: 'scanAndConvert',
    presets: ['-Z "Very Fast 1080p30"'],
    replaceIfSmaller: false,
    fileSuffixes: [''],
    removeApostrophes: false,
    replaceAlways: false,
    reverseQueue: false,
    logDirectory: path.join(root, 'logs'),
    untrustedOutputs: [],
    ...overrides,
  };
}

function write(relativePath: string, contents = 'x'): string {
  const file = path.join(root, 'source', relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

describe('destination math', () => {
  it('uses the container for media and preserves subtitles', () => {
    expect(outputRelativePath('a.mkv', '-x', '.mp4')).toBe('a-x.mp4');
    expect(outputRelativePath('nested/a.b.c.mkv', '', '.mkv')).toBe(
      'nested/a.b.c.mkv',
    );
    expect(outputRelativePath('nested/a.srt', '-ignored', '.mp4')).toBe(
      'nested/a.srt',
    );
  });

  it('joins roots without dropping separators', () => {
    expect(destinationPath('/out', 'nested/a.mp4')).toBe('/out/nested/a.mp4');
  });
});

describe('scanQueue', () => {
  it('lists already-converted files as excluded instead of dropping them', async () => {
    write('a.mp4');
    write('nested/b.mkv');
    const base = config();
    fs.writeFileSync(path.join(root, 'destination', 'a.mp4'), 'already');

    const result = await scanQueue(base);

    expect(result.total).toBe(2);
    expect(result.notExists).toBe(1);
    expect(result.sources).toEqual([
      path.join(root, 'source', 'a.mp4'),
      path.join(root, 'source', 'nested/b.mkv'),
    ]);
    expect(result.destinations).toEqual([
      path.join(root, 'destination', 'a.mp4'),
      path.join(root, 'destination', 'nested/b.mp4'),
    ]);
    expect(result.excluded[0]).toMatchObject({ code: 'alreadyConverted' });
    expect(result.excluded[1]).toBeNull();
    expect(result.traces[0].outcome).toBe('excluded');
    expect(result.traces[1].outcome).toBe('included');
  });

  it('re-queues a file whose destination is an empty placeholder', async () => {
    write('a.mp4');
    const base = config();
    fs.writeFileSync(path.join(root, 'destination', 'a.mp4'), '');

    const result = await scanQueue(base);

    expect(result.notExists).toBe(1);
    expect(result.sources).toEqual([path.join(root, 'source', 'a.mp4')]);
    expect(result.excluded[0]).toBeNull();
  });

  it('does not treat a leftover temp-marked output as converted', async () => {
    write('a.mp4');
    const base = config();
    fs.writeFileSync(
      path.join(root, 'destination', 'a.temp.mp4'),
      'partial conversion',
    );

    const result = await scanQueue(base);

    expect(result.notExists).toBe(1);
    expect(result.excluded[0]).toBeNull();
  });

  it('queues already-converted files when the profile includes them', async () => {
    write('a.mp4');
    write('b.mp4');
    const base = config();
    fs.writeFileSync(path.join(root, 'destination', 'a.mp4'), 'already');

    const result = await scanQueue({
      ...base,
      filterExpression: expression({ includeConverted: true }),
    });

    const index = result.sources.indexOf(path.join(root, 'source', 'a.mp4'));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(result.excluded[index]).toBeNull();
    expect(result.excluded[result.sources.indexOf(path.join(root, 'source', 'b.mp4'))])
      .toBeNull();
    expect(result.notExists).toBe(2);
  });

  it('handles source paths containing commas', async () => {
    const commaRoot = path.join(root, 'source, with comma');
    fs.mkdirSync(commaRoot, { recursive: true });
    fs.writeFileSync(path.join(commaRoot, 'a.mp4'), 'x');

    const result = await scanQueue({ ...config(), sources: [commaRoot] });

    expect(result.sources).toEqual([path.join(commaRoot, 'a.mp4')]);
    expect(result.destinations).toEqual([
      path.join(root, 'destination', 'a.mp4'),
    ]);
  });

  it('applies suffix, title filter and srt flags', async () => {
    write('keep.mp4');
    write('sample.mp4');
    write('subs.srt');

    const result = await scanQueue(
      config({
        fileSuffixes: ['-conv'],
        filterExpression: expression({ titleWords: ['sample'] }),
      }),
    );

    const byName = new Map(
      result.sources.map((source, index) => [
        path.basename(source),
        {
          destination: result.destinations[index],
          skip: result.skipOrCopy[index],
          exclusion: result.excluded[index],
        },
      ]),
    );
    expect(byName.get('keep.mp4')).toMatchObject({
      destination: path.join(root, 'destination', 'keep-conv.mp4'),
      skip: 0,
    });
    expect(byName.get('sample.mp4')?.skip).toBe(1);
    expect(byName.get('sample.mp4')?.exclusion).toMatchObject({
      code: 'filtered',
    });
    expect(byName.get('subs.srt')).toMatchObject({
      destination: path.join(root, 'destination', 'subs.srt'),
      skip: 1,
      exclusion: { code: 'subtitle' },
    });
  });

  it('filters by size and records the failing stage', async () => {
    write('small.mp4', 'x'.repeat(10));
    write('large.mp4', 'x'.repeat(2_000_000));

    const result = await scanQueue(
      config({ filterExpression: expression({ minMb: 1 }) }),
    );

    const smallIndex = result.sources.indexOf(path.join(root, 'source', 'small.mp4'));
    const largeIndex = result.sources.indexOf(path.join(root, 'source', 'large.mp4'));
    expect(result.excluded[smallIndex]).toMatchObject({ code: 'filtered' });
    expect(result.excluded[largeIndex]).toBeNull();
    expect(result.traces[smallIndex].excludedBy).toBeTruthy();
    expect(
      result.traces[smallIndex].entries.find(
        (entry) => entry.ruleId === result.traces[smallIndex].excludedBy,
      )?.field,
    ).toBe('fileSize');
  });

  it('evaluates ffprobe media properties during the scan', async () => {
    const sample = path.join(process.cwd(), 'tests/fixtures/sample.mp4');
    const matchingConfig = config({
      filterExpression: expression({
        fileTypes: ['mp4'],
        mediaProperty: { operator: 'equals', key: 'codec_name', value: 'h264' },
      }),
    });
    fs.copyFileSync(sample, path.join(root, 'source', 'movie.mp4'));

    const matching = await scanQueue(matchingConfig);
    expect(matching.excluded[0]).toBeNull();
    expect(
      matching.traces[0].entries.find((entry) => entry.field === 'mediaProperty')
        ?.status,
    ).toBe('pass');

    const missingConfig = config({
      filterExpression: expression({
        fileTypes: ['mp4'],
        mediaProperty: { operator: 'equals', key: 'codec_name', value: 'hevc' },
      }),
    });
    const missing = await scanQueue(missingConfig);
    expect(missing.excluded[0]).toMatchObject({ code: 'filtered' });
    expect(
      missing.traces[0].entries.find((entry) => entry.field === 'mediaProperty')
        ?.status,
    ).toBe('fail');
  });

  it('computes temp final destinations and reverses the queue', async () => {
    write('a.mp4');
    write('b.mp4');

    const result = await scanQueue(
      config({
        useTempFolder: true,
        tempDestinations: [path.join(root, 'temp')],
        reverseQueue: true,
      }),
    );

    expect(result.sources.map((source) => path.basename(source))).toEqual([
      'b.mp4',
      'a.mp4',
    ]);
    expect(result.destinations[0]).toBe(
      path.join(root, 'destination', 'b.mp4'),
    );
    expect(result.destinationsFinal[0]).toBe(
      path.join(root, 'temp', 'b.mp4'),
    );
  });

  it('renames apostrophes and skips replaced originals', async () => {
    const apostrophe = write("it's.mp4");
    const replaced = write('done.mp4');
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'logs', 'originalFileReplacedList.txt'),
      `${replaced}\n`,
    );

    const result = await scanQueue(
      config({ removeApostrophes: true, replaceIfSmaller: true }),
    );

    expect(fs.existsSync(apostrophe)).toBe(false);
    expect(result.sources).toContain(path.join(root, 'source', 'it s.mp4'));
    const replacedIndex = result.sources.indexOf(replaced);
    expect(replacedIndex).toBeGreaterThanOrEqual(0);
    expect(result.excluded[replacedIndex]).toMatchObject({
      code: 'alreadyReplaced',
    });
  });

  it('emits progress counters', async () => {
    for (let index = 0; index < 120; index += 1) {
      write(`file-${index}.mp4`);
    }
    const progress: Array<{ phase: string; count: number }> = [];

    await scanQueue(config(), {
      onProgress: (phase, count) => progress.push({ phase, count }),
    });

    expect(progress).toContainEqual({ phase: 'discovered', count: 100 });
    expect(progress).toContainEqual({ phase: 'queued', count: 100 });
  });
});
