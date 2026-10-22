import {
  ChildMessagePayload,
  decodeParentMessage,
  ParentMessage,
  toChildMessage,
} from '../processes/protocol';
import { scanQueue } from './scanQueue';

function send(
  message: ChildMessagePayload,
  callback?: (error: Error | null) => void,
): void {
  if (!process.send) return;
  process.send(toChildMessage(message), callback);
}

function log(message: string): void {
  send({ type: 'log', level: 'info', message: String(message) });
}

process.on('uncaughtException', (error) => {
  send({
    type: 'error',
    message: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  send({
    type: 'error',
    message: reason instanceof Error ? reason.message : String(reason),
    ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
  });
  process.exit(1);
});

let running = false;

async function handle(raw: unknown): Promise<void> {
  const decoded = decodeParentMessage(raw);
  if (!decoded.ok) {
    log(`File scanner: rejected message: ${'error' in decoded ? decoded.error : ''}`);
    return;
  }

  const message: ParentMessage = decoded.value;
  if (message.type === 'shutdown') {
    process.exit(0);
  }

  if (running) {
    log('File scanner: already scanning');
    return;
  }

  running = true;
  log('File scanner: received info');

  try {
    const result = await scanQueue(message.payload, {
      onProgress: (phase, count) => send({ type: 'progress', phase, count }),
      onLog: log,
    });
    send({ type: 'complete', payload: result }, () => process.exit(0));
  } catch (error) {
    send(
      {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      },
      () => process.exit(1),
    );
  }
}

process.on('message', (raw: unknown) => {
  void handle(raw);
});

// Announce readiness only after the listener is attached (MIGRATION_STATUS D19).
send({ type: 'ready' });
log('File scanner: online.');
