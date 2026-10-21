import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fork, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogFolders } from '../src/backend/helpers';

const queueBuildPath = fileURLToPath(
  new URL('../src/backend/modules/queueBuild.js', import.meta.url),
);

interface ContractResult {
  total: number;
  sourceQueue: string[];
  presets: string[];
  skipOrCopy: number[];
  destinationQueue: string[];
  notExistsCount: number;
}

let root: string;
let home: string;
let sourceDir: string;
let destinationDir: string;
let child: ChildProcess | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-queue-'));
  home = path.join(root, 'home');
  sourceDir = path.join(root, 'source');
  destinationDir = path.join(root, 'destination');
  fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  createLogFolders(home);
});

afterEach(() => {
  child?.kill();
  child = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeFile(relativePath: string, contents = 'x') {
  const absolute = path.join(sourceDir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}

function queueInfoBomb(overrides: Partial<Record<number, unknown>> = {}) {
  const bomb: unknown[] = [
    'queueInfoBomb',
    [sourceDir],
    [destinationDir],
    [],
    false,
    'mp4,mkv',
    '.mp4',
    'scannonly',
    ['-Z "Very Fast 1080p30"'],
    '',
    false,
    [''],
    false,
    false,
    false,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    bomb[Number(index)] = value;
  }
  return bomb;
}

/** Runs one scan through the real forked module and resolves with its `complete` payload. */
function runScan(bomb: unknown[]): Promise<ContractResult> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `queueBuild did not complete within 20s. Messages: ${JSON.stringify(messages)}`,
          ),
        ),
      20000,
    );

    child = fork(queueBuildPath, [], {
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    child.stderr?.on('data', (chunk) => messages.push(`stderr: ${chunk}`));
    child.stdout?.on('data', (chunk) => messages.push(`stdout: ${chunk}`));

    child.on('error', reject);
    child.on('exit', (code) => {
      clearInterval(resend);
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`queueBuild exited with code ${code}`));
      }
    });

    // The module sends `readyforInfo` before it registers its message listener,
    // so an immediate reply can be dropped. Resend until it acknowledges.
    let acknowledged = false;
    const resend = setInterval(() => {
      if (!acknowledged) child?.send(bomb);
    }, 100);

    child.on('message', (raw) => {
      const message = raw as unknown[];
      messages.push(message);
      if (message[0] === 'readyforInfo') {
        child?.send(bomb);
      }
      if (
        message[0] === 'consoleMessage' &&
        String(message[1]).includes('received info')
      ) {
        acknowledged = true;
        clearInterval(resend);
      }
      if (message[0] === 'complete') {
        clearInterval(resend);
        clearTimeout(timer);
        resolve({
          total: message[1] as number,
          sourceQueue: message[2] as string[],
          presets: message[3] as string[],
          skipOrCopy: message[4] as number[],
          destinationQueue: message[5] as string[],
          notExistsCount: message[7] as number,
        });
      }
      if (message[0] === 'exitRequest') {
        child?.send(['exitApproved']);
      }
    });
  });
}

describe('queueBuild contract', () => {
  it('finds media recursively and mirrors the source tree into the destination', async () => {
    writeFile('a.mp4');
    writeFile('nested/b.mkv');
    writeFile('notes.txt');

    const result = await runScan(queueInfoBomb());

    expect(result.total).toBe(2);
    expect(result.notExistsCount).toBe(2);
    expect(result.sourceQueue.sort()).toEqual([
      path.join(sourceDir, 'a.mp4'),
      path.join(sourceDir, 'nested/b.mkv'),
    ]);
    expect(result.destinationQueue.sort()).toEqual([
      path.join(destinationDir, 'a.mp4'),
      // output extension follows the container, not the source extension
      path.join(destinationDir, 'nested/b.mp4'),
    ]);
    expect(result.presets).toEqual([
      '-Z "Very Fast 1080p30"',
      '-Z "Very Fast 1080p30"',
    ]);
    // the module only writes entries for flagged files, so an empty array means
    // nothing was filtered out
    expect(result.skipOrCopy.filter((flag) => flag === 1)).toEqual([]);
  });

  it('excludes files already present in the destination', async () => {
    writeFile('a.mp4');
    writeFile('b.mp4');
    fs.writeFileSync(path.join(destinationDir, 'a.mp4'), 'already converted');

    const result = await runScan(queueInfoBomb());

    expect(result.total).toBe(2);
    expect(result.sourceQueue).toEqual([path.join(sourceDir, 'b.mp4')]);
  });

  it('flags files matched by the title word filter instead of queueing them', async () => {
    writeFile('keep.mp4');
    writeFile('sample-clip.mp4');

    const result = await runScan(queueInfoBomb({ 9: 'sample' }));

    const sampleIndex = result.sourceQueue.indexOf(
      path.join(sourceDir, 'sample-clip.mp4'),
    );
    expect(sampleIndex).toBeGreaterThanOrEqual(0);
    expect(result.skipOrCopy[sampleIndex]).toBe(1);
  });

  it('ignores file types outside the included list', async () => {
    writeFile('a.mp4');
    writeFile('b.avi');

    const result = await runScan(queueInfoBomb({ 5: 'mp4' }));

    expect(result.sourceQueue).toEqual([path.join(sourceDir, 'a.mp4')]);
  });
});
