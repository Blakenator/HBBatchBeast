import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configureCommand,
  itemCommand,
  cancelItemCommand,
  shutdownCommand,
  WorkerEvent,
  WorkerItemConfig,
} from '../src/backend/workers/protocol';
import {
  EncoderRunOptions,
  EncoderRunResult,
  ProcessRunner,
} from '../src/backend/workers/runner';
import { WorkerRuntime } from '../src/backend/workers/runtime';

const probe = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_type: 'video',
      width: 1920,
      duration: '10',
      nb_frames: '100',
    },
  ],
};

class FakeRunner implements ProcessRunner {
  isCancelled = false;
  callCount = 0;
  lastOptions?: EncoderRunOptions;
  mode: 'success' | 'fail' | 'manual' = 'success';
  outputMode: 'write' | 'missing' = 'write';
  outputContent = 'converted';
  onRun?: (options: EncoderRunOptions) => void;
  private settleManual?: (result: EncoderRunResult) => void;

  async run(options: EncoderRunOptions): Promise<EncoderRunResult> {
    this.callCount += 1;
    this.lastOptions = options;
    this.onRun?.(options);
    options.onStderr?.(
      'Encoding: task 1 of 1, 50.00 % (45.0 fps, avg 50.0 fps, ETA 00h00m05s)',
    );

    if (this.outputMode === 'write') {
      const output = outputPathFromArgs(options.args);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, this.outputContent);
    }

    if (this.mode === 'manual') {
      return new Promise((resolve) => {
        this.settleManual = resolve;
      });
    }

    if (this.mode === 'fail') {
      options.onStderr?.('encoder exploded');
      return { code: 1, signal: null };
    }
    return { code: 0, signal: null };
  }

  async cancel(): Promise<void> {
    this.isCancelled = true;
    this.settleManual?.({ code: null, signal: 'SIGTERM' });
  }
}

function outputPathFromArgs(args: string[]): string {
  const index = args.indexOf('-o');
  return index >= 0 ? args[index + 1] : args[args.length - 1];
}

let root: string;
let logDirectory: string;
let events: WorkerEvent[];
let runner: FakeRunner;
let runtime: WorkerRuntime;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-worker-runtime-'));
  logDirectory = path.join(root, 'logs');
  events = [];
  runner = new FakeRunner();
  runtime = new WorkerRuntime({
    workerNumber: 1,
    send: (event) => events.push(event),
    probe: async () => probe,
    createRunner: () => runner,
    clock: () => new Date('2026-10-21T12:34:56'),
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function item(overrides: Partial<WorkerItemConfig> = {}): WorkerItemConfig {
  return {
    queueNumber: 0,
    sourcePath: path.join(root, 'src', 'a.mp4'),
    outputPath: path.join(root, 'out', 'a.mp4'),
    finalPath: path.join(root, 'out', 'a.mp4'),
    tempOutput: false,
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
    saveWorkerLogs: true,
    filters: {
      include: { mode: 'off', rows: [] },
      exclude: { mode: 'off', rows: [] },
      size: {},
    },
    ...overrides,
  };
}

function writeSource(contents = 'x'.repeat(1000)): string {
  const source = path.join(root, 'src', 'a.mp4');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, contents);
  return source;
}

async function configure(): Promise<void> {
  runtime.start();
  await runtime.handleCommand(
    configureCommand({ logDirectory }),
  );
}

async function runItem(config: WorkerItemConfig): Promise<void> {
  await runtime.handleCommand(itemCommand(config));
  await waitForResult(config.queueNumber);
}

async function waitFor(predicate: () => boolean | undefined): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

async function waitForEvent(
  predicate: (event: WorkerEvent) => boolean,
): Promise<WorkerEvent> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const event = events.find(predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No matching event: ${JSON.stringify(events)}`);
}

async function waitForResult(queueNumber: number): Promise<WorkerEvent> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = events.find(
      (event) => event.type === 'result' && event.queueNumber === queueNumber,
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No result for item ${queueNumber}: ${JSON.stringify(events)}`);
}

function resultEvent(queueNumber: number) {
  return events.find(
    (event) => event.type === 'result' && event.queueNumber === queueNumber,
  ) as Extract<WorkerEvent, { type: 'result' }> | undefined;
}

describe('WorkerRuntime', () => {
  it('emits ready, requests work after configure and completes an encode', async () => {
    const source = writeSource();
    await configure();

    expect(events.map((event) => event.type)).toEqual([
      'ready',
      'request-item',
    ]);

    await runItem(item({ sourcePath: source }));

    const types = events.map((event) => event.type);
    expect(types).toContain('started');
    expect(types).toContain('progress');
    expect(types).toContain('file-sizes');
    expect(resultEvent(0)).toMatchObject({ state: 'success', preset: '-Z "Very Fast 1080p30"' });

    const progress = events.find((event) => event.type === 'progress');
    expect(progress).toMatchObject({
      type: 'progress',
      telemetry: { percent: 50, fps: 45 },
    });

    expect(events.filter((event) => event.type === 'request-item')).toHaveLength(2);
    expect(fs.readFileSync(path.join(logDirectory, 'fileConversionLog.txt'), 'utf8'))
      .toContain('--------Processed----------');
  });

  it('skips and copies without invoking the encoder', async () => {
    const source = writeSource('copy me');
    await configure();

    await runItem(
      item({
        sourcePath: source,
        action: 'skip',
        skipReason: 'Not selected',
      }),
    );
    expect(resultEvent(0)).toMatchObject({
      state: 'excluded',
      detail: 'Not selected',
      reason: 'Not selected',
    });
    expect(runner.callCount).toBe(0);

    const copyTarget = path.join(root, 'out', 'copy.mp4');
    await runItem(
      item({
        queueNumber: 1,
        sourcePath: source,
        action: 'copy',
        finalPath: copyTarget,
      }),
    );
    expect(resultEvent(1)).toMatchObject({ state: 'skipped', detail: 'Copied' });
    expect(fs.readFileSync(copyTarget, 'utf8')).toBe('copy me');
    expect(runner.callCount).toBe(0);
  });

  it('copies subtitle files rejected by a filter even when copying is off', async () => {
    const source = path.join(root, 'src', 'a.srt');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'subtitle');
    const target = path.join(root, 'out', 'a.srt');
    await configure();

    await runItem(
      item({
        sourcePath: source,
        finalPath: target,
        copyFilteredFiles: false,
        filters: {
          include: { mode: 'any', rows: [{ key: 'codec_name', value: 'hevc' }] },
          exclude: { mode: 'off', rows: [] },
          size: {},
        },
      }),
    );

    expect(resultEvent(0)?.state).toBe('skipped');
    expect(fs.readFileSync(target, 'utf8')).toBe('subtitle');
    expect(runner.callCount).toBe(0);
  });

  it('applies include, exclude and size filters', async () => {
    const source = writeSource();
    await configure();

    await runItem(
      item({
        sourcePath: source,
        filters: {
          include: { mode: 'any', rows: [{ key: 'codec_name', value: 'hevc' }] },
          exclude: { mode: 'off', rows: [] },
          size: {},
        },
      }),
    );
    expect(resultEvent(0)).toMatchObject({
      state: 'excluded',
      reason: "Excluded, does not meet 'Include' conditions",
    });
    expect(runner.callCount).toBe(0);

    await runItem(
      item({
        queueNumber: 1,
        sourcePath: source,
        filters: {
          include: { mode: 'off', rows: [] },
          exclude: { mode: 'any', rows: [{ key: 'codec_name', value: 'h264' }] },
          size: {},
        },
      }),
    );
    expect(resultEvent(1)?.state).toBe('excluded');

    await runItem(
      item({
        queueNumber: 2,
        sourcePath: source,
        filters: {
          include: { mode: 'off', rows: [] },
          exclude: { mode: 'off', rows: [] },
          size: { minMb: 1 },
        },
      }),
    );
    expect(resultEvent(2)?.state).toBe('excluded');
    expect(runner.callCount).toBe(0);
  });

  it('copies a filter-rejected file when copyFilteredFiles is set', async () => {
    const source = writeSource('copy filtered');
    await configure();

    await runItem(
      item({
        sourcePath: source,
        copyFilteredFiles: true,
        filters: {
          include: { mode: 'any', rows: [{ key: 'codec_name', value: 'hevc' }] },
          exclude: { mode: 'off', rows: [] },
          size: {},
        },
      }),
    );

    expect(resultEvent(0)).toMatchObject({
      state: 'skipped',
      detail: "Copied: Excluded, does not meet 'Include' conditions",
    });
    expect(
      fs.readFileSync(path.join(root, 'out', 'a.mp4'), 'utf8'),
    ).toBe('copy filtered');
    expect(runner.callCount).toBe(0);
  });

  it('reports a copy failure as an error', async () => {
    await configure();

    await runItem(
      item({
        sourcePath: path.join(root, 'src', 'missing.mp4'),
        action: 'copy',
        finalPath: path.join(root, 'out', 'missing.mp4'),
      }),
    );

    expect(resultEvent(0)?.state).toBe('error');
    expect(resultEvent(0)?.detail).toContain('Copy failed');
  });

  it('reports an encoder failure and writes the error log', async () => {
    runner.mode = 'fail';
    const source = writeSource();
    await configure();

    await runItem(item({ sourcePath: source }));

    expect(resultEvent(0)?.state).toBe('error');
    expect(resultEvent(0)?.detail).toContain('Encoder exited with code 1');
    expect(fs.existsSync(path.join(root, 'out', 'a.mp4'))).toBe(false);
    expect(
      fs.readFileSync(path.join(logDirectory, 'ErrorLog.txt'), 'utf8'),
    ).toContain('encoder exploded');
  });

  it('rejects an empty output file and removes it', async () => {
    runner.outputContent = '';
    const source = writeSource();
    await configure();

    await runItem(item({ sourcePath: source }));

    expect(resultEvent(0)?.state).toBe('error');
    expect(resultEvent(0)?.detail).toContain('NO OUTPUT FILE PRODUCED');
    expect(fs.existsSync(path.join(root, 'out', 'a.mp4'))).toBe(false);
  });

  it('reports a missing output file', async () => {
    runner.outputMode = 'missing';
    const source = writeSource();
    await configure();

    await runItem(item({ sourcePath: source }));

    expect(resultEvent(0)?.state).toBe('error');
    expect(resultEvent(0)?.detail).toContain('NO OUTPUT FILE PRODUCED');
  });

  it('cancels before the encoder starts and never spawns it', async () => {
    runner.mode = 'manual';
    const source = writeSource();
    await configure();

    await runtime.handleCommand(itemCommand(item({ sourcePath: source })));
    await waitForEvent(
      (event) => event.type === 'started' && event.queueNumber === 0,
    );
    await runtime.handleCommand(cancelItemCommand(0));

    await waitForResult(0);
    expect(resultEvent(0)?.state).toBe('cancelled');
    // Cancelling during the probe means the encoder is never launched.
    expect(runner.callCount).toBe(0);
    expect(fs.existsSync(path.join(root, 'out', 'a.mp4'))).toBe(false);
  });

  it('cancels a running encoder and removes its partial output', async () => {
    runner.mode = 'manual';
    const source = writeSource();
    await configure();

    await runtime.handleCommand(itemCommand(item({ sourcePath: source })));
    await waitFor(() => (runner.callCount > 0 ? true : undefined));

    await runtime.handleCommand(cancelItemCommand(0));

    await waitForResult(0);
    expect(resultEvent(0)?.state).toBe('cancelled');
    expect(runner.isCancelled).toBe(true);
    expect(fs.existsSync(path.join(root, 'out', 'a.mp4'))).toBe(false);
  });

  it('moves a staged output into the final destination', async () => {
    const source = writeSource();
    const staging = path.join(root, 'temp', 'a.mp4');
    const final = path.join(root, 'final', 'a.mp4');
    await configure();

    await runItem(
      item({ sourcePath: source, outputPath: staging, finalPath: final }),
    );

    expect(resultEvent(0)?.state).toBe('success');
    expect(fs.existsSync(final)).toBe(true);
    expect(fs.existsSync(staging)).toBe(false);
  });

  it('renames a temp-marked output only after the encode succeeds', async () => {
    const source = writeSource();
    const marked = path.join(root, 'out', 'a.temp.mp4');
    const final = path.join(root, 'out', 'a.mp4');
    await configure();

    await runItem(
      item({
        sourcePath: source,
        outputPath: marked,
        finalPath: final,
        tempOutput: true,
      }),
    );

    expect(resultEvent(0)?.state).toBe('success');
    expect(fs.existsSync(final)).toBe(true);
    expect(fs.existsSync(marked)).toBe(false);
  });

  it('removes a stale marked output before the encoder starts', async () => {
    const source = writeSource();
    const marked = path.join(root, 'out', 'a.temp.mp4');
    fs.mkdirSync(path.dirname(marked), { recursive: true });
    fs.writeFileSync(marked, 'stale');
    let existedWhenEncoderStarted: boolean | undefined;
    runner.onRun = () => {
      existedWhenEncoderStarted = fs.existsSync(marked);
    };
    await configure();

    await runItem(
      item({
        sourcePath: source,
        outputPath: marked,
        finalPath: path.join(root, 'out', 'a.mp4'),
        tempOutput: true,
      }),
    );

    expect(existedWhenEncoderStarted).toBe(false);
    expect(resultEvent(0)?.state).toBe('success');
  });

  it('removes the marked output when a running encode is cancelled', async () => {
    runner.mode = 'manual';
    const source = writeSource();
    const marked = path.join(root, 'out', 'a.temp.mp4');
    await configure();

    await runtime.handleCommand(
      itemCommand(
        item({
          sourcePath: source,
          outputPath: marked,
          finalPath: path.join(root, 'out', 'a.mp4'),
          tempOutput: true,
        }),
      ),
    );
    await waitFor(() => (runner.callCount > 0 ? true : undefined));
    await runtime.handleCommand(cancelItemCommand(0));

    await waitForResult(0);
    expect(resultEvent(0)?.state).toBe('cancelled');
    expect(fs.existsSync(marked)).toBe(false);
    expect(fs.existsSync(path.join(root, 'out', 'a.mp4'))).toBe(false);
  });

  it('keeps the source and the marked file when the final rename fails', async () => {
    const source = writeSource();
    const marked = path.join(root, 'out', 'a.temp.mp4');
    const blockedFinal = path.join(root, 'out', 'a.mp4');
    // A non-empty directory in the way makes fs-extra's move fail.
    fs.mkdirSync(blockedFinal, { recursive: true });
    fs.writeFileSync(path.join(blockedFinal, 'keep.txt'), 'x');
    await configure();

    await runItem(
      item({
        sourcePath: source,
        outputPath: marked,
        finalPath: blockedFinal,
        tempOutput: true,
        deleteSource: true,
        replaceOriginal: 'always',
      }),
    );

    expect(resultEvent(0)?.state).toBe('error');
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(marked)).toBe(true);
  });

  it('deletes the source when configured and no replacement is requested', async () => {
    const source = writeSource();
    await configure();

    await runItem(item({ sourcePath: source, deleteSource: true }));

    expect(resultEvent(0)?.state).toBe('success');
    expect(fs.existsSync(source)).toBe(false);
  });

  it('replaces the original only when the converted file is smaller', async () => {
    const source = writeSource('x'.repeat(500));
    runner.outputContent = 'small';
    await configure();

    await runItem(item({ sourcePath: source, replaceOriginal: 'smaller' }));

    expect(fs.readFileSync(source, 'utf8')).toBe('small');
    expect(
      fs.readFileSync(path.join(logDirectory, 'originalFileReplacedList.txt'), 'utf8'),
    ).toContain(source);

    const largerSource = writeSource('x'.repeat(2));
    runner.outputContent = 'much larger output';
    await runItem(
      item({
        queueNumber: 1,
        sourcePath: largerSource,
        outputPath: path.join(root, 'out', 'b.mp4'),
        finalPath: path.join(root, 'out', 'b.mp4'),
        replaceOriginal: 'always',
      }),
    );
    expect(resultEvent(1)?.state).toBe('success');
  });

  it('runs a custom batch script', async () => {
    const source = writeSource();
    const marker = path.join(root, 'bat-ran');
    const bat = path.join(root, 'after.sh');
    fs.writeFileSync(bat, `#!/bin/sh\ntouch "${marker}"\n`);
    fs.chmodSync(bat, 0o755);
    await configure();

    await runItem(item({ sourcePath: source, customBatPath: bat }));

    expect(fs.existsSync(marker)).toBe(true);
  });

  it('rejects invalid commands and ignores a second item while busy', async () => {
    await configure();
    await runtime.handleCommand({ v: 1, type: 'nope' });
    expect(
      events.some(
        (event) => event.type === 'console' && event.level === 'error',
      ),
    ).toBe(true);

    runner.mode = 'manual';
    const source = writeSource();
    await runtime.handleCommand(itemCommand(item({ sourcePath: source })));
    await waitForEvent(
      (event) => event.type === 'started' && event.queueNumber === 0,
    );
    await runtime.handleCommand(
      itemCommand(item({ queueNumber: 1, sourcePath: source })),
    );
    expect(
      events.some(
        (event) =>
          event.type === 'console' &&
          event.message.includes('ignoring item 1'),
      ),
    ).toBe(true);
    await runtime.handleCommand(cancelItemCommand(0));
  });

  it('exits on shutdown and stops requesting work', async () => {
    await configure();
    const before = events.filter((event) => event.type === 'request-item').length;
    expect(await runtime.handleCommand(shutdownCommand())).toBe(true);
    expect(
      events.filter((event) => event.type === 'request-item').length,
    ).toBe(before);
  });
});
