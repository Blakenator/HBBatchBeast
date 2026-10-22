import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  RunManager,
  RunState,
  WorkerHandlers,
  WorkerHandle,
} from '../src/backend/run/runManager';
import {
  WorkerItemConfig,
  WorkerResultState,
  WorkerTelemetry,
} from '../src/backend/workers/protocol';

class FakeWorker implements WorkerHandle {
  readonly sent: WorkerItemConfig[] = [];
  stopped = false;
  cancelled = 0;
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private current?: WorkerItemConfig;

  constructor(
    readonly number: number,
    private readonly handlers: WorkerHandlers,
    private readonly result: WorkerResultState = 'success',
  ) {}

  async start(): Promise<void> {
    this.handlers.onQueueRequest();
  }

  sendItem(config: WorkerItemConfig): void {
    this.sent.push(config);
    this.current = config;
    this.handlers.onStarted(config.queueNumber);
    this.pendingTimer = setTimeout(() => {
      if (this.stopped || this.current !== config) return;
      this.handlers.onResult(
        config.queueNumber,
        this.result,
        this.result === 'error' ? 'boom' : '',
      );
      this.current = undefined;
      this.handlers.onQueueRequest();
    }, 5);
  }

  cancelItem(queueNumber: number): void {
    this.cancelled += 1;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.current?.queueNumber !== queueNumber) return;
    this.current = undefined;
    this.handlers.onResult(queueNumber, 'cancelled', 'Cancelled by user');
    this.handlers.onQueueRequest();
  }

  emitProgress(queueNumber: number, telemetry: WorkerTelemetry): void {
    this.handlers.onProgress(queueNumber, telemetry, 'raw');
  }

  crash(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.handlers.onExit();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }
}

function buildConfig(item: { path: string }, index: number): WorkerItemConfig {
  return {
    queueNumber: index,
    sourcePath: item.path,
    outputPath: `/dst/${index}.mp4`,
    finalPath: `/dst/${index}.mp4`,
    action: 'encode',
    copyFilteredFiles: false,
    encoder: {
      kind: 'handbrake',
      executable: 'HandBrakeCLI',
      preset: '-Z "x"',
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
  };
}

const items = [
  { path: '/src/a.mp4', preset: '-Z "x"' },
  { path: '/src/b.mp4', preset: '-Z "x"' },
  { path: '/src/c.mp4', preset: '-Z "x"' },
];

let root: string;
let workers: FakeWorker[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-run-'));
  workers = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeManager(
  result: WorkerResultState = 'success',
  workerCount = 2,
  journal = false,
  onState?: (state: RunState) => void,
): RunManager {
  return new RunManager({
    workerCount,
    buildItemConfig: buildConfig,
    onState,
    journalPath: journal ? path.join(root, 'journal.json') : undefined,
    createWorker: (number, handlers) => {
      const worker = new FakeWorker(number, handlers, result);
      workers.push(worker);
      return worker;
    },
  });
}

describe('RunManager', () => {
  it('dispatches every item and completes the run', async () => {
    const states: RunState[] = [];
    const manager = makeManager('success', 2, false, (state) =>
      states.push(JSON.parse(JSON.stringify(state)) as RunState),
    );

    await manager.start(items);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.counts).toMatchObject({
      total: 3,
      success: 3,
      pending: 0,
      running: 0,
      error: 0,
    });
    expect(state.items.every((item) => item.state === 'success')).toBe(true);
    expect(workers.length).toBe(2);
    expect(workers.flatMap((worker) => worker.sent).length).toBe(3);
    expect(states.length).toBeGreaterThan(1);
  });

  it('records failures and continues with the remaining items', async () => {
    const manager = makeManager('error');
    await manager.start(items);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.counts.error).toBe(3);
    expect(state.items[0].reason).toBe('boom');
  });

  it('treats skipped as skipped rather than an error', async () => {
    const manager = makeManager('skipped');
    await manager.start([items[0]]);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    expect(manager.getState().counts.skipped).toBe(1);
  });

  it('parks idle workers while paused and drains them on resume', async () => {
    const manager = makeManager('success', 1);
    await manager.start([items[0], items[1]]);
    manager.pause();

    await vi.waitFor(() => expect(workers[0].sent.length).toBe(1));
    // The worker finished item 0 and asked for more, but dispatch stays parked.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(workers[0].sent.length).toBe(1);
    expect(manager.getState().status).toBe('paused');

    manager.resume();
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));
    expect(workers[0].sent).toHaveLength(2);
  });

  it('shows scanner exclusions as terminal rows and never dispatches them', async () => {
    const manager = makeManager('success', 1);
    await manager.start([
      { path: '/src/a.mp4', preset: '-Z "x"' },
      {
        path: '/src/b.mp4',
        preset: '-Z "x"',
        destinationPath: '/dst/b.mp4',
        action: 'skip',
        excludedReason: 'Already converted',
      },
    ]);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.items[1]).toMatchObject({
      state: 'excluded',
      reason: 'Already converted',
    });
    expect(state.counts).toMatchObject({ excluded: 1, success: 1, total: 2 });
    // The excluded row never reached a worker.
    expect(workers[0].sent).toHaveLength(1);
  });

  it('records worker filter rejections as excluded with a reason', async () => {
    const manager = new RunManager({
      workerCount: 1,
      buildItemConfig: buildConfig,
      createWorker: (_number, handlers) => ({
        start: async () => handlers.onQueueRequest(),
        cancelItem: () => undefined,
        stop: async () => undefined,
        sendItem: (config) => {
          handlers.onStarted(config.queueNumber);
          handlers.onResult(
            config.queueNumber,
            'excluded',
            "Excluded, does not meet 'Include' conditions",
            "Excluded, does not meet 'Include' conditions",
          );
        },
      }),
    });

    await manager.start([items[0]]);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    expect(manager.getState().items[0]).toMatchObject({
      state: 'excluded',
      reason: "Excluded, does not meet 'Include' conditions",
    });
  });

  it('stops the run and cancels outstanding items', async () => {
    const manager = makeManager('success', 1);
    await manager.start(items);
    await manager.stop();

    const state = manager.getState();
    expect(state.status).toBe('completed');
    expect(state.counts.cancelled + state.counts.success).toBe(3);
    expect(workers.every((worker) => worker.stopped)).toBe(true);
  });

  it('cancels a single pending item without stopping the run', async () => {
    const manager = makeManager('success', 1);
    await manager.start(items);
    manager.cancelItem(1);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.items[1].state).toBe('cancelled');
    expect(state.counts.cancelled).toBe(1);
  });

  it('cancels the running encoder and dispatches the next item', async () => {
    const manager = makeManager('success', 1);
    await manager.start(items);
    await vi.waitFor(() => expect(workers[0].sent.length).toBe(1));

    manager.cancelItem(0);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(workers[0].cancelled).toBe(1);
    expect(state.items[0].state).toBe('cancelled');
    expect(state.items[1].state).toBe('success');
    expect(state.items[2].state).toBe('success');
  });

  it('ignores late progress from a cancelled item', async () => {
    const manager = makeManager('success', 1);
    await manager.start(items);
    await vi.waitFor(() => expect(workers[0].sent.length).toBe(1));

    manager.cancelItem(0);
    workers[0].emitProgress(0, { percent: 99 });

    const item = manager.getState().items[0];
    expect(item.state).toBe('cancelled');
    expect(item.percent).toBeUndefined();
    expect(item.progress).toBeUndefined();

    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));
  });

  it('writes a journal that reports an interrupted run', async () => {
    const journalPath = path.join(root, 'journal.json');
    const manager = makeManager('success', 1, true);
    await manager.start([items[0]]);
    manager.pause();

    const interrupted = RunManager.readInterruptedJournal(journalPath);
    expect(interrupted?.status).toBe('paused');
    expect(interrupted?.items[0].path).toBe('/src/a.mp4');

    await manager.stop();
    expect(RunManager.readInterruptedJournal(journalPath)).toBeNull();
  });

  it('rejects a second start while a run is active', async () => {
    const manager = makeManager('success', 1);
    await manager.start(items);
    await expect(manager.start(items)).rejects.toThrow(/already in progress/);
    await manager.stop();
  });

  it('records structured progress, timings and a failure log tail', async () => {
    const sourcePath = path.join(root, 'source.mp4');
    fs.writeFileSync(sourcePath, '0123456789');

    const manager = new RunManager({
      workerCount: 1,
      buildItemConfig: buildConfig,
      createWorker: (_number, handlers) => ({
        start: async () => handlers.onQueueRequest(),
        cancelItem: () => undefined,
        stop: async () => undefined,
        sendItem: (config) => {
          handlers.onStarted(config.queueNumber);
          handlers.onProgress(
            config.queueNumber,
            { percent: 42.5, fps: 45.67, etaSeconds: 30 },
            'Encoding: task 1 of 1, 42.50 %',
          );
          handlers.onConsole('sub worker error: boom');
          handlers.onFileSizes(config.queueNumber, 10, 4);
          handlers.onResult(config.queueNumber, 'error', 'trace line');
        },
      }),
    });

    await manager.start([{ path: sourcePath, preset: '-Z "x"' }]);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const item = manager.getState().items[0];
    expect(item.state).toBe('error');
    expect(item.sourceBytes).toBe(10);
    expect(item.outputBytes).toBe(4);
    expect(item.startedAt).toBeTypeOf('number');
    expect(item.finishedAt).toBeGreaterThanOrEqual(item.startedAt!);
    expect(item.progress).toMatchObject({
      percent: 42.5,
      fps: 45.67,
      etaSeconds: 30,
    });
    expect(item.reason).toBe('trace line');
    expect(item.logTail).toEqual(['sub worker error: boom']);
  });

  it('tracks bytes written while an item is encoding', async () => {
    const manager = new RunManager({
      workerCount: 1,
      buildItemConfig: buildConfig,
      createWorker: (_number, handlers) => ({
        start: async () => handlers.onQueueRequest(),
        cancelItem: () => undefined,
        stop: async () => undefined,
        sendItem: (config) => {
          handlers.onStarted(config.queueNumber);
          handlers.onProgress(
            config.queueNumber,
            { percent: 20, bytes: 1234 },
            'Encoding: 20%',
          );
        },
      }),
    });

    await manager.start([
      { path: '/src/live.mp4', preset: '-Z "x"', destinationPath: '/dst/live.mp4' },
    ]);

    expect(manager.getState().items[0].writtenBytes).toBe(1234);
    await manager.stop();
  });

  it('fails the active and pending items when the only worker crashes', async () => {
    const manager = makeManager('success', 1);
    await manager.start(items);
    await vi.waitFor(() => expect(workers[0].sent.length).toBe(1));

    workers[0].crash();
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.counts.error).toBe(3);
    expect(state.items.every((item) => item.reason === 'Worker exited unexpectedly')).toBe(
      true,
    );
  });

  it('marks a build failure as an item error and keeps dispatching', async () => {
    const manager = new RunManager({
      workerCount: 1,
      buildItemConfig: (item, index) => {
        if (item.path === '/src/b.mp4') throw new Error('bad config');
        return buildConfig(item, index);
      },
      createWorker: (number, handlers) => {
        const worker = new FakeWorker(number, handlers, 'success');
        workers.push(worker);
        return worker;
      },
    });

    await manager.start(items);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.items[1]).toMatchObject({
      state: 'error',
      reason: 'bad config',
    });
    expect(state.items[0].state).toBe('success');
    expect(state.items[2].state).toBe('success');
  });

  it('drops the console tail of successful items', async () => {
    const manager = new RunManager({
      workerCount: 1,
      buildItemConfig: buildConfig,
      createWorker: (_number, handlers) => ({
        start: async () => handlers.onQueueRequest(),
        cancelItem: () => undefined,
        stop: async () => undefined,
        sendItem: (config) => {
          handlers.onStarted(config.queueNumber);
          handlers.onConsole('launching sub worker');
          handlers.onResult(config.queueNumber, 'success', '');
        },
      }),
    });

    await manager.start([items[0]]);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    expect(manager.getState().items[0].logTail).toBeUndefined();
  });
});
