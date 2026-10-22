import fs from 'fs';
import path from 'path';
import {
  WorkerItemConfig,
  WorkerResultState,
  WorkerTelemetry,
} from '../workers/protocol';
import { RunItemProgress } from '../../common/runTelemetry';

export type RunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'interrupted';

export type RunItemState =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped';

export interface RunItem {
  path: string;
  preset: string;
  destinationPath?: string;
  destinationFinalPath?: string;
  action?: 'encode' | 'copy' | 'skip';
  state: RunItemState;
  worker?: number;
  percent?: string;
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Size measured when the item starts, used for live byte throughput. */
  sourceBytes?: number;
  /** Size of the converted file, reported by the worker after success. */
  outputBytes?: number;
  progress?: RunItemProgress;
  /**
   * Console lines the worker emitted while this item was in flight. Only kept
   * for items that did not succeed, so a large successful run stays small.
   */
  logTail?: string[];
}

export interface RunCounts {
  total: number;
  pending: number;
  running: number;
  success: number;
  error: number;
  cancelled: number;
  skipped: number;
}

export interface RunLogLine {
  worker: number;
  message: string;
  at: number;
}

export interface RunState {
  status: RunStatus;
  items: RunItem[];
  counts: RunCounts;
  logs: RunLogLine[];
  workerCount: number;
  startedAt?: number;
  finishedAt?: number;
}

const MAX_LOG_LINES = 500;
const MAX_ITEM_LOG_LINES = 80;

export interface WorkerHandlers {
  onQueueRequest: () => void;
  onStarted: (queueNumber: number) => void;
  onProgress: (
    queueNumber: number,
    telemetry: WorkerTelemetry,
    raw: string,
  ) => void;
  onFileSizes: (
    queueNumber: number,
    sourceBytes: number,
    outputBytes: number,
  ) => void;
  onResult: (
    queueNumber: number,
    state: WorkerResultState,
    detail: string,
  ) => void;
  onConsole: (message: string) => void;
  onExit: () => void;
}

export interface WorkerHandle {
  start: () => Promise<void>;
  sendItem: (config: WorkerItemConfig) => void;
  /** Stops the item this worker is processing without killing the worker. */
  cancelItem: (queueNumber: number) => void;
  stop: () => Promise<void>;
}

export interface RunManagerDeps {
  createWorker: (workerNumber: number, handlers: WorkerHandlers) => WorkerHandle;
  buildItemConfig: (item: RunItem, index: number) => WorkerItemConfig;
  onState?: (state: RunState) => void;
  onConsole?: (worker: number, message: string) => void;
  workerCount?: number;
  /** Omit to disable journaling (tests). */
  journalPath?: string;
}

const TERMINAL_STATES: RunItemState[] = [
  'success',
  'error',
  'cancelled',
  'skipped',
];

/**
 * Owns a conversion run: queue, worker pool, pause/resume/stop and the run
 * journal. The renderer only observes state and sends commands, which fixes the
 * legacy design where the queue lived in DOM nodes.
 */
export class RunManager {
  private state: RunState = {
    status: 'idle',
    items: [],
    logs: [],
    workerCount: 1,
    counts: {
      total: 0,
      pending: 0,
      running: 0,
      success: 0,
      error: 0,
      cancelled: 0,
      skipped: 0,
    },
  };

  private workers: WorkerHandle[] = [];
  /** Which queue item each worker is converting right now. */
  private activeByWorker = new Map<number, number>();
  /** Idle workers that asked for work while the run was paused. */
  private pendingRequests = new Set<number>();
  /** Worker numbers whose process exited; they must not be dispatched again. */
  private exitedWorkers = new Set<number>();
  private stopped = false;
  private lastJournalWrite = 0;

  constructor(private readonly deps: RunManagerDeps) {}

  getState(): RunState {
    return this.state;
  }

  async start(
    items: {
      path: string;
      preset: string;
      destinationPath?: string;
      destinationFinalPath?: string;
      action?: 'encode' | 'copy' | 'skip';
    }[],
  ): Promise<void> {
    if (this.state.status === 'running' || this.state.status === 'paused') {
      throw new Error('A run is already in progress');
    }

    this.stopped = false;
    this.activeByWorker.clear();
    this.pendingRequests.clear();
    this.exitedWorkers.clear();
    const workerCount = Math.max(1, this.deps.workerCount ?? 1);
    this.state = {
      status: 'running',
      items: items.map((item) => ({ ...item, state: 'pending' as const })),
      counts: {
        total: items.length,
        pending: items.length,
        running: 0,
        success: 0,
        error: 0,
        cancelled: 0,
        skipped: 0,
      },
      logs: [],
      workerCount,
      startedAt: Date.now(),
    };
    this.emit(true);

    for (let index = 0; index < workerCount; index += 1) {
      this.workers.push(this.createWorker(index + 1));
    }
    await Promise.all(this.workers.map((worker) => worker.start()));
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.state.status = 'paused';
    this.emit(true);
  }

  resume(): void {
    if (this.state.status !== 'paused') return;
    this.state.status = 'running';
    this.emit(true);
    this.drainPendingRequests();
  }

  async stop(): Promise<void> {
    if (!['running', 'paused'].includes(this.state.status)) return;
    this.stopped = true;
    this.state.status = 'stopping';
    this.state.items.forEach((item) => {
      if (item.state === 'running' || item.state === 'pending') {
        item.state = 'cancelled';
        item.reason = 'Stopped by user';
        if (item.startedAt !== undefined) item.finishedAt = Date.now();
      }
    });
    this.recount();
    this.emit(true);

    await Promise.all(this.workers.map((worker) => worker.stop()));
    this.activeByWorker.clear();
    this.pendingRequests.clear();
    this.exitedWorkers.clear();
    this.workers = [];
    this.finish('completed');
  }

  cancelItem(index: number): void {
    const item = this.state.items[index];
    if (!item || TERMINAL_STATES.includes(item.state)) return;

    const workerNumber = item.worker;
    const runningWorker =
      workerNumber !== undefined &&
      this.activeByWorker.get(workerNumber) === index
        ? this.workers[workerNumber - 1]
        : undefined;

    item.state = 'cancelled';
    item.reason = 'Cancelled by user';
    item.percent = undefined;
    item.progress = undefined;
    if (item.startedAt !== undefined) item.finishedAt = Date.now();
    if (workerNumber !== undefined) this.activeByWorker.delete(workerNumber);
    this.recount();
    this.emit(true);

    // A pending item has no process yet; a running one must have its encoder
    // killed so the worker can request the next item.
    runningWorker?.cancelItem(index);
    this.checkForCompletion();
  }

  /** The most recent journal, if the app died mid-run. */
  static readInterruptedJournal(journalPath: string): RunState | null {
    try {
      if (!fs.existsSync(journalPath)) return null;
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as RunState;
      return journal.status === 'running' || journal.status === 'paused'
        ? journal
        : null;
    } catch {
      return null;
    }
  }

  private createWorker(workerNumber: number): WorkerHandle {
    let index = -1;
    const worker = this.deps.createWorker(workerNumber, {
      onQueueRequest: () => {
        if (this.stopped || this.state.status === 'stopping') return;
        if (this.state.status === 'paused') {
          this.pendingRequests.add(workerNumber);
          return;
        }
        this.dispatchToWorker(workerNumber, worker, (next) => {
          index = next;
        });
      },
      onStarted: (queueNumber) => {
        const item = this.state.items[queueNumber];
        if (!item) return;
        if (item.state === 'pending') item.state = 'running';
        if (item.startedAt === undefined) item.startedAt = Date.now();
        item.progress = undefined;
        this.activeByWorker.set(workerNumber, queueNumber);
        this.recount();
        this.emit();
      },
      onProgress: (queueNumber, telemetry) => {
        const item = this.state.items[queueNumber];
        // Cancelled items must ignore late encoder telemetry.
        if (!item || item.state !== 'running') return;
        if (telemetry.percent !== undefined) {
          item.percent = `${telemetry.percent}%`;
        }
        item.progress = { ...(item.progress ?? {}), ...telemetry };
        this.emit();
      },
      onFileSizes: (queueNumber, sourceBytes, outputBytes) => {
        const item = this.state.items[queueNumber];
        if (!item || item.state !== 'running') return;
        if (sourceBytes > 0) item.sourceBytes = sourceBytes;
        if (outputBytes > 0) item.outputBytes = outputBytes;
        this.emit();
      },
      onResult: (queueNumber, state, detail) => {
        const item = this.state.items[queueNumber];
        if (item && !TERMINAL_STATES.includes(item.state)) {
          item.state =
            state === 'success'
              ? 'success'
              : state === 'skipped'
                ? 'skipped'
                : state === 'cancelled'
                  ? 'cancelled'
                  : 'error';
          item.reason = detail || undefined;
          item.percent = undefined;
          if (item.state === 'success') {
            item.progress = { ...item.progress, percent: 100 };
          }
          if (item.startedAt !== undefined) item.finishedAt = Date.now();
          // A successful item's console tail is noise and would bloat a
          // 10k-item run; failures keep it for diagnosis.
          if (item.state === 'success') item.logTail = undefined;
        }
        this.activeByWorker.delete(workerNumber);
        this.recount();
        this.emit(true);
        this.checkForCompletion();
      },
      onConsole: (message) => {
        this.deps.onConsole?.(workerNumber, message);
        this.state.logs.push({ worker: workerNumber, message, at: Date.now() });
        if (this.state.logs.length > MAX_LOG_LINES) {
          this.state.logs.splice(0, this.state.logs.length - MAX_LOG_LINES);
        }
        const active = this.activeByWorker.get(workerNumber);
        const item = active === undefined ? undefined : this.state.items[active];
        if (item && item.state === 'running') {
          item.logTail = [...(item.logTail ?? []), message].slice(
            -MAX_ITEM_LOG_LINES,
          );
        }
        this.emit();
      },
      onExit: () => {
        if (this.stopped || this.state.status === 'stopping') return;
        const hasWork = this.state.items.some((item) =>
          ['pending', 'running'].includes(item.state),
        );
        if (!hasWork) return;
        this.exitedWorkers.add(workerNumber);

        const active = this.activeByWorker.get(workerNumber);
        if (active !== undefined) {
          const item = this.state.items[active];
          if (item && !TERMINAL_STATES.includes(item.state)) {
            item.state = 'error';
            item.reason = 'Worker exited unexpectedly';
            if (item.startedAt !== undefined) item.finishedAt = Date.now();
          }
          this.activeByWorker.delete(workerNumber);
        }

        const anyAlive = this.workers.some(
          (_worker, index) => !this.exitedWorkers.has(index + 1),
        );
        if (!anyAlive) {
          this.state.items.forEach((item) => {
            if (item.state === 'pending') {
              item.state = 'error';
              item.reason = 'Worker exited unexpectedly';
              item.finishedAt = Date.now();
            }
          });
        }

        this.recount();
        this.emit(true);
        this.checkForCompletion();
      },
    });
    return worker;
  }

  /** Returns the next item index, or undefined when nothing is left. */
  private takeNextItem(worker: number): number | undefined {
    const index = this.state.items.findIndex((item) => item.state === 'pending');
    if (index === -1) return undefined;
    const item = this.state.items[index];
    item.state = 'running';
    item.worker = worker;
    item.startedAt = Date.now();
    item.logTail = [];
    item.sourceBytes = this.readFileSize(item.path);
    this.activeByWorker.set(worker, index);
    this.recount();
    this.emit();
    return index;
  }

  /** Best-effort source size for byte throughput; never fails the run. */
  private readFileSize(filePath: string): number | undefined {
    try {
      const stats = fs.statSync(filePath);
      return Number.isFinite(stats.size) ? stats.size : undefined;
    } catch {
      return undefined;
    }
  }

  private dispatchToWorker(
    workerNumber: number,
    worker: WorkerHandle,
    onDispatched?: (index: number) => void,
  ): void {
    if (this.stopped || this.state.status !== 'running') {
      if (this.state.status === 'paused') {
        this.pendingRequests.add(workerNumber);
      }
      return;
    }
    if (this.exitedWorkers.has(workerNumber)) return;

    this.pendingRequests.delete(workerNumber);
    const next = this.takeNextItem(workerNumber);
    if (next === undefined) {
      void worker.stop().catch((): void => undefined);
      this.checkForCompletion();
      return;
    }

    try {
      onDispatched?.(next);
      worker.sendItem(this.deps.buildItemConfig(this.state.items[next], next));
    } catch (error) {
      const item = this.state.items[next];
      item.state = 'error';
      item.reason =
        error instanceof Error ? error.message : 'Could not dispatch the item';
      item.finishedAt = Date.now();
      this.activeByWorker.delete(workerNumber);
      this.recount();
      this.emit(true);
      // The worker is still idle; let it pick up the next item without
      // recursing through a long invalid queue.
      setTimeout(() => {
        if (!this.stopped && this.state.status === 'running') {
          this.dispatchToWorker(workerNumber, worker);
        }
      }, 0);
      this.checkForCompletion();
    }
  }

  private drainPendingRequests(): void {
    if (this.stopped || this.state.status !== 'running') return;
    const pending = [...this.pendingRequests];
    this.pendingRequests.clear();
    for (const workerNumber of pending) {
      const worker = this.workers[workerNumber - 1];
      if (worker) this.dispatchToWorker(workerNumber, worker);
    }
  }

  private checkForCompletion(): void {
    if (this.stopped || this.workers.length === 0) return;
    const busy = this.state.items.some((item) =>
      ['pending', 'running'].includes(item.state),
    );
    if (busy) return;

    void Promise.all(this.workers.map((worker) => worker.stop()))
      .catch((): void => undefined)
      .then(() => {
        this.workers = [];
        this.finish('completed');
      });
  }

  private finish(status: RunStatus): void {
    this.state.status = status;
    this.state.finishedAt = Date.now();
    this.recount();
    this.emit(true);
  }

  private recount(): void {
    const counts: RunCounts = {
      total: this.state.items.length,
      pending: 0,
      running: 0,
      success: 0,
      error: 0,
      cancelled: 0,
      skipped: 0,
    };
    for (const item of this.state.items) {
      if (item.state === 'pending') counts.pending += 1;
      else if (item.state === 'running') counts.running += 1;
      else if (item.state === 'success') counts.success += 1;
      else if (item.state === 'error') counts.error += 1;
      else if (item.state === 'cancelled') counts.cancelled += 1;
      else counts.skipped += 1;
    }
    this.state.counts = counts;
  }

  private emit(forceJournal = false): void {
    this.deps.onState?.(this.getState());
    this.writeJournal(forceJournal);
  }

  private writeJournal(force: boolean): void {
    const journalPath = this.deps.journalPath;
    if (!journalPath) return;

    const now = Date.now();
    if (!force && now - this.lastJournalWrite < 1000) return;
    this.lastJournalWrite = now;

    try {
      fs.mkdirSync(path.dirname(journalPath), { recursive: true });
      fs.writeFileSync(
        journalPath,
        JSON.stringify(
          { ...this.state, items: this.state.items.slice(0, 5000) },
          null,
          2,
        ),
      );
    } catch {
      // journaling is best-effort; never fail a run over it
    }
  }
}
