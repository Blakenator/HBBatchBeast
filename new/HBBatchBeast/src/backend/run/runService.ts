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
): WorkerHandle {
  const supervisor = new ChildSupervisor({
    name: `worker-${workerNumber}`,
    entry: resolveChildEntry('worker1'),
    args: [String(workerNumber)],
    // worker1 still emits its own array format; translate it in the callback.
    parseMessage: () => null,
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
            handlers.onProgress(event.queueNumber, event.percent);
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
    createWorker: createWorkerHandle,
  });
}
