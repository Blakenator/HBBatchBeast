import path from 'path';
import { AppError } from '@superflag/super-ipc-core';
import { ChildSupervisor } from '../processes/childSupervisor';
import { resolveChildEntry } from '../processes/childEntries';
import {
  RunItem,
  RunManager,
  RunState,
  WorkerHandlers,
  WorkerHandle,
} from './runManager';
import {
  encodeWorkerItem,
  parseWorkerEvent,
  WorkerItemConfig,
} from './workerProtocol';

export interface RunServiceOptions {
  workerCount: number;
  /** Caller owns the configuration shape; the service only dispatches. */
  buildItemConfig: (item: RunItem, index: number) => WorkerItemConfig;
  onState?: (state: RunState) => void;
  onConsole?: (worker: number, message: string) => void;
  journalPath?: string;
  /** Overrides where child entry points are resolved from (tests/dev). */
  entryBaseDir?: string;
}

export function defaultJournalPath(homePath: string): string {
  return path.join(
    homePath,
    'Documents/HBBatchBeast/Config/run-journal.json',
  );
}

function createWorkerHandle(
  workerNumber: number,
  handlers: WorkerHandlers,
  entryBaseDir?: string,
): WorkerHandle {
  const supervisor = new ChildSupervisor({
    name: `worker-${workerNumber}`,
    entry: resolveChildEntry('worker1', entryBaseDir),
    args: [String(workerNumber)],
    // worker1 still emits its own array format; translate it in the callback.
    parseMessage: () => null,
    // worker1's first message is its queue request, which doubles as readiness.
    isReadyMessage: (raw) =>
      Array.isArray(raw) && raw[1] === 'queueRequest',
    // worker1 predates the typed protocol; `suicide` makes it kill its
    // encoder/analyser children before exiting.
    shutdownMessage: ['suicide'],
    events: {
      onRawMessage: (raw) => {
        const event = parseWorkerEvent(raw);
        if (!event) return;

        switch (event.type) {
          case 'queueRequest':
            handlers.onQueueRequest();
            break;
          case 'console':
            handlers.onConsole(event.message);
            break;
          case 'started':
            handlers.onStarted(event.queueNumber);
            break;
          case 'progress':
            handlers.onProgress(event.queueNumber, event.percent, event.raw);
            break;
          case 'fileSizes':
            handlers.onFileSizes(
              event.queueNumber,
              event.sourceBytes,
              event.outputBytes,
            );
            break;
          case 'result':
            handlers.onResult(event.queueNumber, event.state, event.detail);
            break;
          case 'logAppend':
            // worker1 used to ask the main process to write its logs, which
            // blocked the event loop. It owns its log writes now.
            break;
          case 'probe':
          case 'exitRequest':
            break;
        }
      },
      onError: (error) => handlers.onConsole(error.message),
    },
  });

  return {
    start: () => supervisor.start(),
    sendItem: (config) => supervisor.sendRaw(encodeWorkerItem(config)),
    cancelItem: () => {
      try {
        supervisor.sendRaw(['exitThread']);
      } catch {
        // The worker may already be exiting; the item stays cancelled.
      }
    },
    resume: () => supervisor.sendRaw(['continueWork']),
    stop: async () => {
      try {
        supervisor.sendRaw(['suicide']);
      } catch {
        // already gone
      }
      await supervisor.stop('worker-finished');
    },
  };
}

/**
 * Creates the run manager for a conversion. One run at a time: the caller keeps
 * the instance until the run reports a terminal state.
 */
export function createRunManager(
  homePath: string,
  options: RunServiceOptions,
): RunManager {
  if (options.workerCount < 1) {
    throw new AppError('Worker count must be at least 1');
  }

  return new RunManager({
    workerCount: options.workerCount,
    onState: options.onState,
    onConsole: options.onConsole,
    journalPath: options.journalPath ?? defaultJournalPath(homePath),
    buildItemConfig: options.buildItemConfig,
    createWorker: (workerNumber, handlers) =>
      createWorkerHandle(workerNumber, handlers, options.entryBaseDir),
  });
}
