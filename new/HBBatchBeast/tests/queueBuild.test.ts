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
  new URL('../src/backend/modules/queueBuild.js', import.meta.url),
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
  const absolute = path.join(sourceDir, relativePath);
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
    env: { HOME: home },
    readyTimeoutMs: 10000,
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

  it('excludes files already present in the destination', async () => {
    writeFile('a.mp4');
    writeFile('b.mp4');
    fs.writeFileSync(path.join(destinationDir, 'a.mp4'), 'already converted');

    const result = await runScan(baseBatch());

    expect(result.total).toBe(2);
    expect(result.sources).toEqual([path.join(sourceDir, 'b.mp4')]);
  });

  it('flags files matched by the title word filter instead of queueing them', async () => {
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
});
