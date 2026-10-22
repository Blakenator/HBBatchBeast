import { toWorkerEvent, WorkerEvent } from './protocol';
import { WorkerRuntime } from './runtime';

function send(event: WorkerEvent): void {
  if (process.send) process.send(event);
}

const workerNumber = Number.parseInt(process.argv[2] ?? '', 10);

if (!Number.isInteger(workerNumber) || workerNumber < 0) {
  process.stderr.write('worker1: missing or invalid worker number\n');
  process.exit(1);
}

const runtime = new WorkerRuntime({ workerNumber, send });

runtime.start();

process.on('message', (raw: unknown) => {
  void runtime
    .handleCommand(raw)
    .then((shouldExit) => {
      if (shouldExit) process.exit(0);
    })
    .catch((error: unknown) => {
      send(
        toWorkerEvent({
          type: 'console',
          level: 'error',
          message: `Worker ${workerNumber} command failed: ${
            error instanceof Error ? error.stack ?? error.message : String(error)
          }`,
        }),
      );
      process.exit(1);
    });
});

process.on('uncaughtException', (error) => {
  send(
    toWorkerEvent({
      type: 'console',
      level: 'error',
      message: `Worker ${workerNumber} crashed: ${error.stack ?? error.message}`,
    }),
  );
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  send(
    toWorkerEvent({
      type: 'console',
      level: 'error',
      message: `Worker ${workerNumber} unhandled rejection: ${
        reason instanceof Error ? reason.stack ?? reason.message : String(reason)
      }`,
    }),
  );
  process.exit(1);
});

process.on('disconnect', () => process.exit(0));
