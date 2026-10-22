import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChildSupervisor } from '../src/backend/processes/childSupervisor';
import {
  cancelItemCommand,
  configureCommand,
  decodeWorkerEvent,
  itemCommand,
  shutdownCommand,
  WorkerEvent,
  WorkerItemConfig,
} from '../src/backend/workers/protocol';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const workerEntry = path.join(repoRoot, 'src/backend/workers/worker1.ts');
const fakeEncoder = path.join(
  repoRoot,
  'tests/fixtures/fake-encoder.cjs',
);

let root: string;
let bins: string;
let argvFile: string;
let supervisor: ChildSupervisor;
let events: WorkerEvent[];
let errors: string[];

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-worker-fork-'));
  bins = path.join(root, 'bin');
  argvFile = path.join(root, 'argv.jsonl');
  fs.mkdirSync(bins, { recursive: true });
  for (const name of ['HandBrakeCLI', 'ffmpeg']) {
    const target = path.join(bins, name);
    fs.copyFileSync(fakeEncoder, target);
    fs.chmodSync(target, 0o755);
  }
  events = [];
  errors = [];
});

afterEach(async () => {
  await supervisor?.stop('test-cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});

async function start(env: NodeJS.ProcessEnv = {}): Promise<void> {
  supervisor = new ChildSupervisor({
    name: 'worker-fork-test',
    entry: workerEntry,
    args: ['1'],
    execArgv: ['-r', 'ts-node/register/transpile-only'],
    env: {
      PATH: `${bins}:${process.env.PATH ?? ''}`,
      FAKE_ARGV_FILE: argvFile,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: 'commonjs',
        moduleResolution: 'node',
      }),
      ...env,
    },
    readyTimeoutMs: 20000,
    shutdownGraceMs: 1000,
    killGraceMs: 1000,
    parseMessage: () => null,
    isReadyMessage: (raw) => {
      const decoded = decodeWorkerEvent(raw);
      return decoded.ok && decoded.value.type === 'ready';
    },
    events: {
      onRawMessage: (raw) => {
        const decoded = decodeWorkerEvent(raw);
        if (decoded.ok) events.push(decoded.value);
        else errors.push(decoded.error);
      },
      onError: (error) => errors.push(error.message),
    },
  });

  await supervisor.start();
  supervisor.sendRaw(
    configureCommand({ logDirectory: path.join(root, 'logs') }),
  );
}

function item(overrides: Partial<WorkerItemConfig> = {}): WorkerItemConfig {
  return {
    queueNumber: 0,
    sourcePath: path.join(root, 'src', 'a.mp4'),
    outputPath: path.join(root, 'out', 'a.mp4'),
    finalPath: path.join(root, 'out', 'a.mp4'),
    action: 'encode',
    copyFilteredFiles: false,
    encoder: {
      kind: 'handbrake',
      executable: 'HandBrakeCLI',
      preset: '-Z "Very Fast 1080p30"',
      presetImportFiles: [],
    },
    deleteSource: false,
    replaceOriginal: 'never',
    customBatPath: '',
    lowPriority: false,
    saveWorkerLogs: false,
    filters: {
      include: { mode: 'off', rows: [] },
      exclude: { mode: 'off', rows: [] },
      size: {},
    },
    ...overrides,
  };
}

function writeSource(name = 'a.mp4'): string {
  const source = path.join(root, 'src', name);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'x'.repeat(1000));
  return source;
}

async function waitForResult(queueNumber: number): Promise<WorkerEvent> {
  return waitFor(
    () =>
      events.find(
        (event) => event.type === 'result' && event.queueNumber === queueNumber,
      ),
    15000,
    `result ${queueNumber}`,
  );
}

async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for ${label}: ${JSON.stringify({ events, errors })}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function readArgv(): string[][] {
  if (!fs.existsSync(argvFile)) return [];
  return fs
    .readFileSync(argvFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

describe('worker1 fork contract', () => {
  it('processes two HandBrake items in sequence with preset imports', async () => {
    await start({ FAKE_PROGRESS: 'Encoding: task 1 of 1, 50.00 % (45.0 fps)' });
    const first = writeSource('a.mp4');
    const second = writeSource('b.mp4');

    supervisor.sendRaw(
      itemCommand(
        item({
          sourcePath: first,
          encoder: {
            kind: 'handbrake',
            executable: 'HandBrakeCLI',
            preset: '-Z "Very Fast 1080p30"',
            presetImportFiles: ['/home/user/presets.json'],
          },
        }),
      ),
    );
    expect(await waitForResult(0)).toMatchObject({ state: 'success' });

    supervisor.sendRaw(
      itemCommand(
        item({
          queueNumber: 1,
          sourcePath: second,
          outputPath: path.join(root, 'out', 'b.mp4'),
          finalPath: path.join(root, 'out', 'b.mp4'),
        }),
      ),
    );
    expect(await waitForResult(1)).toMatchObject({ state: 'success' });

    expect(readArgv()).toEqual([
      [
        '--preset-import-file',
        '/home/user/presets.json',
        '-i',
        first,
        '-o',
        path.join(root, 'out', 'a.mp4'),
        '-Z',
        'Very Fast 1080p30',
      ],
      [
        '-i',
        second,
        '-o',
        path.join(root, 'out', 'b.mp4'),
        '-Z',
        'Very Fast 1080p30',
      ],
    ]);
    expect(
      events.some(
        (event) => event.type === 'progress' && event.telemetry.percent === 50,
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(root, 'logs', 'fileConversionLog.txt'), 'utf8'),
    ).toContain('--------Processed----------');
  });

  it('runs FFmpeg with input and output option pairs', async () => {
    await start();
    const source = writeSource();

    supervisor.sendRaw(
      itemCommand(
        item({
          sourcePath: source,
          encoder: {
            kind: 'ffmpeg',
            executable: 'ffmpeg',
            preset: '-y -ss 1,-c:v libx264 -crf 20',
            presetImportFiles: [],
          },
        }),
      ),
    );

    expect(await waitForResult(0)).toMatchObject({ state: 'success' });
    expect(readArgv()[0]).toEqual([
      '-y',
      '-ss',
      '1',
      '-i',
      source,
      '-c:v',
      'libx264',
      '-crf',
      '20',
      path.join(root, 'out', 'a.mp4'),
    ]);
  });

  it('cancels the running encoder and remains usable', async () => {
    await start({ FAKE_DELAY_MS: '5000' });
    const source = writeSource();

    supervisor.sendRaw(itemCommand(item({ sourcePath: source })));
    await waitFor(
      () => events.find((event) => event.type === 'started'),
      15000,
      'started',
    );
    supervisor.sendRaw(cancelItemCommand(0));

    expect(await waitForResult(0)).toMatchObject({ state: 'cancelled' });
    // The worker requests the next item after cancellation.
    expect(
      events.filter((event) => event.type === 'request-item').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('exits on a shutdown command', async () => {
    await start();
    supervisor.sendRaw(shutdownCommand());
    await waitFor(
      () => (supervisor.isRunning ? undefined : true),
      5000,
      'worker exit',
    );
    expect(supervisor.isRunning).toBe(false);
  });
});
