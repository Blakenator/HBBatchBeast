import path from 'path';
import { AppError } from '@superflag/super-ipc-core';
import { ChildSupervisor } from '../processes/childSupervisor';
import { resolveChildEntry } from '../processes/childEntries';
import { defaultLogDirectory } from '../helpers/buildQueueBuildConfig';
import {
  cancelItemCommand,
  configureCommand,
  decodeErrorMessage,
  decodeWorkerEvent,
  itemCommand,
  WorkerItemConfig,
} from '../workers/protocol';
import {
  RunItem,
  RunManager,
  RunState,
  WorkerHandlers,
  WorkerHandle,
} from './runManager';

export interface RunServiceOptions {
  workerCount: number;
  /** Caller owns the configuration shape; the service only dispatches. */
  buildItemConfig: (item: RunItem, index: number) => WorkerItemConfig;
  onState?: (state: RunState) => void;
  onConsole?: (worker: number, message: string) => void;
  journalPath?: string;
  /** Overrides where child entry points are resolved from (tests/dev). */
  entryBaseDir?: string;
  /** Where the worker writes its command/conversion/error logs. */
  logDirectory?: string;
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
  logDirectory: string,
  entryBaseDir?: string,
): WorkerHandle {
  const supervisor = new ChildSupervisor({
    name: `worker-${workerNumber}`,
    entry: resolveChildEntry('worker1', entryBaseDir),
    args: [String(workerNumber)],
    parseMessage: () => null,
    isReadyMessage: (raw) => {
      const decoded = decodeWorkerEvent(raw);
      return decoded.ok && decoded.value.type === 'ready';
    },
    events: {
      onRawMessage: (raw) => {
        const decoded = decodeWorkerEvent(raw);
        if (!decoded.ok) {
          handlers.onConsole(
            `Invalid worker message: ${decodeErrorMessage(decoded)}`,
          );
          return;
        }

        const event = decoded.value;
        switch (event.type) {
          case 'ready':
            break;
          case 'request-item':
            handlers.onQueueRequest();
            break;
          case 'console':
            handlers.onConsole(event.message);
            break;
          case 'started':
            handlers.onStarted(event.queueNumber);
            break;
          case 'progress':
            handlers.onProgress(
              event.queueNumber,
              event.telemetry,
              event.raw,
            );
            break;
          case 'file-sizes':
            handlers.onFileSizes(
              event.queueNumber,
              event.sourceBytes,
              event.outputBytes,
            );
            break;
          case 'result':
            handlers.onResult(event.queueNumber, event.state, event.detail);
            break;
        }
      },
      onError: (error) => handlers.onConsole(error.message),
      onExit: () => handlers.onExit(),
    },
  });

  return {
    start: async () => {
      await supervisor.start();
      supervisor.sendRaw(configureCommand({ logDirectory }));
    },
    sendItem: (config) => supervisor.sendRaw(itemCommand(config)),
    cancelItem: (queueNumber) => {
      try {
        supervisor.sendRaw(cancelItemCommand(queueNumber));
      } catch {
        // The worker may already be exiting; the item stays cancelled.
      }
    },
    stop: async () => {
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

  const logDirectory = options.logDirectory ?? defaultLogDirectory(homePath);

  return new RunManager({
    workerCount: options.workerCount,
    onState: options.onState,
    onConsole: options.onConsole,
    journalPath: options.journalPath ?? defaultJournalPath(homePath),
    buildItemConfig: options.buildItemConfig,
    createWorker: (workerNumber, handlers) =>
      createWorkerHandle(workerNumber, handlers, logDirectory, options.entryBaseDir),
  });
}
