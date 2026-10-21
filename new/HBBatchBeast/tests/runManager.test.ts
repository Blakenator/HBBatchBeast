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
import { WorkerItemConfig } from '../src/backend/run/workerProtocol';

class FakeWorker implements WorkerHandle {
  readonly sent: WorkerItemConfig[] = [];
  stopped = false;
  resumed = 0;
  private pendingTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly number: number,
    private readonly handlers: WorkerHandlers,
    private readonly result: 'OK' | 'Fail' | 'Skip' = 'OK',
  ) {}

  async start(): Promise<void> {
    this.handlers.onQueueRequest();
  }

  sendItem(config: WorkerItemConfig): void {
    this.sent.push(config);
    this.handlers.onStarted(config.queueNumber);
    this.pendingTimer = setTimeout(() => {
      if (this.stopped) return;
      this.handlers.onResult(config.queueNumber, this.result, this.result === 'Fail' ? 'boom' : '');
      this.handlers.onQueueRequest();
    }, 5);
  }

  resume(): void {
    this.resumed += 1;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }
}

function buildConfig(item: { path: string }, index: number): WorkerItemConfig {
  return {
    queueNumber: index,
    skipOrCopy: 0,
    copyOnOff: false,
    replaceOriginalFile: false,
    moveCorruptFileOnOff: false,
    corruptDestinationPath: '',
    mode: 'scanAndConvert',
    itemChecked: true,
    fileFiltersInclude: '',
    fileFiltersExclude: '',
    replaceOriginalFileAlways: false,
    includeAnyProperties: false,
    includeAllProperties: false,
    excludeAnyProperties: false,
    excludeAllProperties: false,
    handBrakeMode: true,
    ffmpegMode: false,
    deleteSourceFiles: false,
    customBatOn: false,
    tempFolderSelected: false,
    sourcePath: item.path,
    preset: '-Z "x"',
    destinationPath: '',
    destinationFinalPath: '',
    minFileSizeOnOff: false,
    minFileSize: '',
    maxFileSizeOnOff: false,
    maxFileSize: '',
    thoroughHealthCheck: false,
    repairFile: false,
    repairCrfValue: '23',
    handBrakeCliPath: 'HandBrakeCLI',
    ffmpegPath: 'ffmpeg',
    saveWorkerLogs: false,
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
  result: 'OK' | 'Fail' | 'Skip' = 'OK',
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
    const manager = makeManager('OK', 2, false, (state) =>
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
    // work was spread over the pool rather than one worker doing everything
    expect(workers.length).toBe(2);
    expect(workers.flatMap((worker) => worker.sent).length).toBe(3);
    expect(states.length).toBeGreaterThan(1);
  });

  it('records failures and continues with the remaining items', async () => {
    const manager = makeManager('Fail');
    await manager.start(items);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.counts.error).toBe(3);
    expect(state.items[0].reason).toBe('boom');
  });

  it('treats Skip as skipped rather than an error', async () => {
    const manager = makeManager('Skip');
    await manager.start([items[0]]);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    expect(manager.getState().counts.skipped).toBe(1);
  });

  it('pauses dispatch and resumes it', async () => {
    const manager = makeManager('OK', 1);
    await manager.start([items[0], items[1]]);

    manager.pause();
    expect(manager.getState().status).toBe('paused');

    manager.resume();
    expect(manager.getState().status).toBe('running');
    expect(workers[0].resumed).toBe(1);

    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));
  });

  it('stops the run and cancels outstanding items', async () => {
    const manager = makeManager('OK', 1);
    await manager.start(items);
    await manager.stop();

    const state = manager.getState();
    expect(state.status).toBe('completed');
    expect(state.counts.cancelled + state.counts.success).toBe(3);
    expect(workers.every((worker) => worker.stopped)).toBe(true);
  });

  it('cancels a single item without stopping the run', async () => {
    const manager = makeManager('OK', 1);
    await manager.start(items);
    manager.cancelItem(1);
    await vi.waitFor(() => expect(manager.getState().status).toBe('completed'));

    const state = manager.getState();
    expect(state.items[1].state).toBe('cancelled');
    expect(state.counts.cancelled).toBe(1);
  });

  it('writes a journal that reports an interrupted run', async () => {
    const journalPath = path.join(root, 'journal.json');
    const manager = makeManager('OK', 1, true);
    await manager.start([items[0]]);
    manager.pause();

    const interrupted = RunManager.readInterruptedJournal(journalPath);
    expect(interrupted?.status).toBe('paused');
    expect(interrupted?.items[0].path).toBe('/src/a.mp4');

    await manager.stop();
    expect(RunManager.readInterruptedJournal(journalPath)).toBeNull();
  });

  it('rejects a second start while a run is active', async () => {
    const manager = makeManager('OK', 1);
    await manager.start(items);
    await expect(manager.start(items)).rejects.toThrow(/already in progress/);
    await manager.stop();
  });
});
