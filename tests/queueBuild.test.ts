import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogFolders } from '../src/backend/helpers';
import { buildQueueBuildConfig } from '../src/backend/helpers/buildQueueBuildConfig';
import { ChildSupervisor } from '../src/backend/processes/childSupervisor';
import { QueueBuildResult } from '../src/backend/processes/protocol';
import { BatchOperationMode, GlobalAppConfig } from '../src/common';

const queueBuildPath = fileURLToPath(
  new URL('../src/backend/scanner/queueBuild.ts', import.meta.url),
);

let root: string;
let home: string;
let sourceDir: string;
let destinationDir: string;
let supervisor: ChildSupervisor | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-queue-'));
  home = path.join(root, 'home');
  sourceDir = path.join(root, 'source');
  destinationDir = path.join(root, 'destination');
  fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  createLogFolders(home);
});

afterEach(async () => {
  await supervisor?.stop('test-cleanup');
  supervisor = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeFile(relativePath: string, contents = 'x') {
  writeFileIn(sourceDir, relativePath, contents);
}

function writeFileIn(rootDir: string, relativePath: string, contents = 'x') {
  const absolute = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}

function makeConfig(
  batch: GlobalAppConfig['configs'][number]['tab_batch'],
): GlobalAppConfig {
  return {
    lang: 'en',
    selected_config: 0,
    version_message: 'test',
    configs: [{ name: 'Default', tab_batch: batch }],
  };
}

async function runScan(
  batch: Parameters<typeof makeConfig>[0],
): Promise<QueueBuildResult> {
  const payload = buildQueueBuildConfig({
    config: makeConfig(batch),
    operationMode: BatchOperationMode.ScanOnly,
    logDirectory: path.join(home, 'Documents/HBBatchBeast/Logs'),
  });

  let complete: (result: QueueBuildResult) => void;
  let fail: (error: unknown) => void;
  const done = new Promise<QueueBuildResult>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });

  supervisor = new ChildSupervisor({
    name: 'queueBuild-test',
    entry: queueBuildPath,
    env: {
      HOME: home,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: 'commonjs',
        moduleResolution: 'node',
      }),
    },
    execArgv: ['-r', 'ts-node/register/transpile-only'],
    readyTimeoutMs: 20000,
    events: {
      onChildMessage: (message) => {
        if (message.type === 'complete') complete(message.payload);
      },
      onError: (error) => fail(error),
    },
  });

  await supervisor.start();
  supervisor.configure(payload);
  return done;
}

const baseBatch = () => ({
  path: {
    source_path: sourceDir,
    destination_path: destinationDir,
  },
  preset: 'Very Fast 1080p30',
  container: '.mp4',
  advanced: { included_file_types: 'mp4,mkv' },
});

describe('queueBuild contract', () => {
  it('finds media recursively and mirrors the source tree into the destination', async () => {
    writeFile('a.mp4');
    writeFile('nested/b.mkv');
    writeFile('notes.txt');

    const result = await runScan(baseBatch());

    expect(result.total).toBe(2);
    expect(result.notExists).toBe(2);
    expect(result.sources.sort()).toEqual([
      path.join(sourceDir, 'a.mp4'),
      path.join(sourceDir, 'nested/b.mkv'),
    ]);
    expect([...result.destinations].sort()).toEqual([
      path.join(destinationDir, 'a.mp4'),
      // output extension follows the container, not the source extension
      path.join(destinationDir, 'nested/b.mp4'),
    ]);
    expect(result.presets).toEqual([
      '-Z "Very Fast 1080p30"',
      '-Z "Very Fast 1080p30"',
    ]);
    expect(result.skipOrCopy.filter((flag) => flag === 1)).toEqual([]);
  });

  it('lists files already present in the destination as excluded', async () => {
    writeFile('a.mp4');
    writeFile('b.mp4');
    fs.writeFileSync(path.join(destinationDir, 'a.mp4'), 'already converted');

    const result = await runScan(baseBatch());

    expect(result.total).toBe(2);
    expect(result.sources).toHaveLength(2);
    const convertedIndex = result.sources.indexOf(path.join(sourceDir, 'a.mp4'));
    expect(result.excluded[convertedIndex]).toMatchObject({
      code: 'alreadyConverted',
    });
    expect(result.notExists).toBe(1);
  });

  it('flags files matched by the title word filter with a reason', async () => {
    writeFile('keep.mp4');
    writeFile('sample-clip.mp4');

    const result = await runScan({
      ...baseBatch(),
      advanced: { included_file_types: 'mp4,mkv', title_word_filter: 'sample' },
    });

    const sampleIndex = result.sources.indexOf(
      path.join(sourceDir, 'sample-clip.mp4'),
    );
    expect(sampleIndex).toBeGreaterThanOrEqual(0);
    expect(result.skipOrCopy[sampleIndex]).toBe(1);
    expect(result.excluded[sampleIndex]).toMatchObject({ code: 'filtered' });
    expect(result.excluded[sampleIndex]?.reason).toContain('sample');
  });

  it('ignores file types outside the included list', async () => {
    writeFile('a.mp4');
    writeFile('b.avi');

    const result = await runScan({
      ...baseBatch(),
      advanced: { included_file_types: 'mp4' },
    });

    expect(result.sources).toEqual([path.join(sourceDir, 'a.mp4')]);
  });

  it('keeps one suffix aligned with each source folder', async () => {
    const secondSource = path.join(root, 'source-b');
    fs.mkdirSync(secondSource, { recursive: true });
    writeFile('a.mp4');
    writeFileIn(secondSource, 'b.mp4');

    const result = await runScan({
      ...baseBatch(),
      path: {
        source_path: `${sourceDir}\n${secondSource}`,
        destination_path: `${destinationDir}\n${destinationDir}`,
      },
      advanced: {
        included_file_types: 'mp4',
        file_name_suffix_toggle: 1,
        file_name_suffix: '-first\n-second',
      },
    });

    expect([...result.destinations].sort()).toEqual([
      path.join(destinationDir, 'a-first.mp4'),
      path.join(destinationDir, 'b-second.mp4'),
    ]);
  });

  it('computes a separate final destination when staging is enabled', async () => {
    const tempDir = path.join(root, 'temp');
    const finalDir = path.join(root, 'final');
    writeFile('a.mp4');

    const result = await runScan({
      ...baseBatch(),
      path: {
        source_path: sourceDir,
        destination_path: tempDir,
        temp_toggle: 1,
        temp_destination_path: finalDir,
      },
    });

    expect(result.destinations).toEqual([path.join(tempDir, 'a.mp4')]);
    expect(result.destinationsFinal).toEqual([path.join(finalDir, 'a.mp4')]);
  });

  it('reverses the queue when configured', async () => {
    writeFile('a.mp4');
    writeFile('b.mp4');
    writeFile('c.mp4');

    const result = await runScan({
      ...baseBatch(),
      advanced: { included_file_types: 'mp4', reverse_file_queue: 1 },
    });

    expect(result.sources).toEqual([
      path.join(sourceDir, 'c.mp4'),
      path.join(sourceDir, 'b.mp4'),
      path.join(sourceDir, 'a.mp4'),
    ]);
  });

  it('includes subtitle files and flags them for copying', async () => {
    writeFile('a.mp4');
    writeFile('a.srt');

    const result = await runScan({
      ...baseBatch(),
      advanced: { included_file_types: 'mp4', copy_srt_files_toggle: 1 },
    });

    const srtIndex = result.sources.indexOf(path.join(sourceDir, 'a.srt'));
    expect(srtIndex).toBeGreaterThanOrEqual(0);
    expect(result.skipOrCopy[srtIndex]).toBe(1);
    expect(result.excluded[srtIndex]).toMatchObject({ code: 'subtitle' });
    expect(result.destinations[srtIndex]).toBe(
      path.join(destinationDir, 'a.srt'),
    );
  });

  it('renames apostrophes in source names before queueing them', async () => {
    writeFile("it's here.mp4");

    const result = await runScan({
      ...baseBatch(),
      advanced: {
        included_file_types: 'mp4',
        remove_filename_apostrophes: 1,
      },
    });

    expect(result.sources).toEqual([path.join(sourceDir, 'it s here.mp4')]);
    expect(fs.existsSync(path.join(sourceDir, "it's here.mp4"))).toBe(false);
  });

  it('lists files recorded in the replaced-originals log as excluded', async () => {
    writeFile('a.mp4');
    writeFile('b.mp4');
    const replacedPath = path.join(sourceDir, 'a.mp4');
    fs.appendFileSync(
      path.join(home, 'Documents/HBBatchBeast/Logs/originalFileReplacedList.txt'),
      `${replacedPath}\n`,
    );

    const result = await runScan({
      ...baseBatch(),
      advanced: {
        included_file_types: 'mp4',
        replace_original_file_if_converted_is_smaller_toggle: 1,
      },
    });

    const replacedIndex = result.sources.indexOf(replacedPath);
    expect(replacedIndex).toBeGreaterThanOrEqual(0);
    expect(result.excluded[replacedIndex]).toMatchObject({
      code: 'alreadyReplaced',
    });
    const otherIndex = result.sources.indexOf(path.join(sourceDir, 'b.mp4'));
    expect(result.excluded[otherIndex]).toBeNull();
  });

  it('uses the configured container extension for outputs', async () => {
    writeFile('a.mp4');

    const result = await runScan({
      ...baseBatch(),
      container: '.mkv',
    });

    expect(result.destinations).toEqual([path.join(destinationDir, 'a.mkv')]);
  });
});
