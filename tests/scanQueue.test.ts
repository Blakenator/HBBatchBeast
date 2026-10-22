import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
    includedFileTypes: 'mp4,mkv,srt',
    container: '.mp4',
    mode: 'scanAndConvert',
    presets: ['-Z "Very Fast 1080p30"'],
    titleWordFilter: '',
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
      config({ fileSuffixes: ['-conv'], titleWordFilter: 'sample' }),
    );

    const byName = new Map(
      result.sources.map((source, index) => [
        path.basename(source),
        {
          destination: result.destinations[index],
          skip: result.skipOrCopy[index],
        },
      ]),
    );
    expect(byName.get('keep.mp4')).toEqual({
      destination: path.join(root, 'destination', 'keep-conv.mp4'),
      skip: 0,
    });
    expect(byName.get('sample.mp4')?.skip).toBe(1);
    expect(
      result.excluded[result.sources.indexOf(path.join(root, 'source', 'sample.mp4'))],
    ).toMatchObject({ code: 'titleMatch' });
    expect(byName.get('subs.srt')).toEqual({
      destination: path.join(root, 'destination', 'subs.srt'),
      skip: 1,
    });
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
