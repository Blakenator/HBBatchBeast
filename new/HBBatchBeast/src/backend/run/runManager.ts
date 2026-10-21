import fs from 'fs';
import path from 'path';
import { WorkerItemConfig } from './workerProtocol';

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
  state: RunItemState;
  worker?: number;
  percent?: string;
  reason?: string;
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

export interface RunState {
  status: RunStatus;
  items: RunItem[];
  counts: RunCounts;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkerHandlers {
  onQueueRequest: () => void;
  onStarted: (queueNumber: number) => void;
  onProgress: (queueNumber: number, percent: string) => void;
  onResult: (
    queueNumber: number,
    state: 'OK' | 'Fail' | 'Skip' | 'Copy' | 'cancelled' | 'error',
    detail: string,
  ) => void;
  onConsole: (message: string) => void;
  onExit: () => void;
}

export interface WorkerHandle {
  start: () => Promise<void>;
  sendItem: (config: WorkerItemConfig) => void;
  resume: () => void;
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
  private stopped = false;
  private lastJournalWrite = 0;

  constructor(private readonly deps: RunManagerDeps) {}

  getState(): RunState {
    return this.state;
  }

  async start(items: { path: string; preset: string; destinationPath?: string }[]): Promise<void> {
    if (this.state.status === 'running' || this.state.status === 'paused') {
      throw new Error('A run is already in progress');
    }

    this.stopped = false;
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
      startedAt: Date.now(),
    };
    this.emit(true);

    const workerCount = Math.max(1, this.deps.workerCount ?? 1);
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
    this.workers.forEach((worker) => worker.resume());
    this.emit(true);
    this.dispatch();
  }

  async stop(): Promise<void> {
    if (!['running', 'paused'].includes(this.state.status)) return;
    this.stopped = true;
    this.state.status = 'stopping';
    this.state.items.forEach((item) => {
      if (item.state === 'running' || item.state === 'pending') {
        item.state = 'cancelled';
        item.reason = 'Stopped by user';
      }
    });
    this.recount();
    this.emit(true);

    await Promise.all(this.workers.map((worker) => worker.stop()));
    this.workers = [];
    this.finish('completed');
  }

  cancelItem(index: number): void {
    const item = this.state.items[index];
    if (!item || TERMINAL_STATES.includes(item.state)) return;
    item.state = 'cancelled';
    item.reason = 'Cancelled by user';
    this.recount();
    this.emit(true);
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
        const next = this.takeNextItem(workerNumber);
        if (next === undefined) {
          void worker.stop().catch((): void => undefined);
          this.checkForCompletion();
          return;
        }
        index = next;
        worker.sendItem(this.deps.buildItemConfig(this.state.items[index], index));
      },
      onStarted: (queueNumber) => {
        const item = this.state.items[queueNumber];
        if (item && item.state === 'pending') item.state = 'running';
        this.recount();
        this.emit();
      },
      onProgress: (queueNumber, percent) => {
        const item = this.state.items[queueNumber];
        if (!item) return;
        item.percent = percent;
        this.emit();
      },
      onResult: (queueNumber, result, detail) => {
        const item = this.state.items[queueNumber];
        if (item && !TERMINAL_STATES.includes(item.state)) {
          item.state =
            result === 'OK'
              ? 'success'
              : result === 'Skip' || result === 'Copy'
                ? 'skipped'
                : result === 'cancelled'
                  ? 'cancelled'
                  : 'error';
          item.reason = detail || undefined;
          item.percent = undefined;
        }
        this.recount();
        this.emit(true);
        this.checkForCompletion();
      },
      onConsole: (message) => this.deps.onConsole?.(workerNumber, message),
      onExit: () => this.checkForCompletion(),
    });
    return worker;
  }

  /** Returns the next item index, or undefined when nothing is left. */
  private takeNextItem(worker: number): number | undefined {
    const index = this.state.items.findIndex((item) => item.state === 'pending');
    if (index === -1) return undefined;
    this.state.items[index].state = 'running';
    this.state.items[index].worker = worker;
    this.recount();
    this.emit();
    return index;
  }

  private dispatch(): void {
    if (this.stopped) return;
    const hasPending = this.state.items.some((item) => item.state === 'pending');
    if (!hasPending) {
      this.checkForCompletion();
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
