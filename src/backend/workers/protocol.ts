import { z } from 'zod';

/**
 * Typed contract between the main process and `worker1`.
 *
 * The child is forked by `runService`, receives structured commands, and emits
 * structured events. Both sides decode with these schemas, so a version or shape
 * mismatch fails loudly instead of silently reading the wrong slot.
 */

export const WORKER_PROTOCOL_VERSION = 1;

export const WORKER_RESULT_STATES = [
  'success',
  'error',
  /** Completed without converting (copy/passthrough). */
  'skipped',
  /** Deliberately not converted, with a reason. */
  'excluded',
  'cancelled',
] as const;

export type WorkerResultState = (typeof WORKER_RESULT_STATES)[number];

const propertyFilterRowSchema = z
  .object({
    key: z.string().trim().min(1),
    value: z.string(),
  })
  .strict();

const propertyFilterSchema = z
  .object({
    mode: z.enum(['off', 'any', 'all']),
    rows: z.array(propertyFilterRowSchema),
  })
  .strict();

const sizeFilterSchema = z
  .object({
    minMb: z.number().finite().nonnegative().optional(),
    maxMb: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.minMb === undefined ||
      value.maxMb === undefined ||
      value.minMb <= value.maxMb,
    { message: 'minMb must not exceed maxMb' },
  );

const encoderConfigSchema = z
  .object({
    kind: z.enum(['handbrake', 'ffmpeg']),
    executable: z.string().trim().min(1),
    preset: z.string(),
    presetImportFiles: z.array(z.string().trim().min(1)),
  })
  .strict();

export const workerSetupSchema = z
  .object({
    logDirectory: z.string().trim().min(1),
  })
  .strict();

export type WorkerSetup = z.infer<typeof workerSetupSchema>;

export const workerItemConfigSchema = z
  .object({
    queueNumber: z.number().int().nonnegative(),
    sourcePath: z.string().trim().min(1),
    /** Work output used by the encoder (may be a temp path). */
    outputPath: z.string().trim().min(1),
    /** Final destination; equal to outputPath when not staging. */
    finalPath: z.string().trim().min(1),
    action: z.enum(['encode', 'copy', 'skip']),
    skipReason: z.string().optional(),
    /** Copy files rejected by property/size filters instead of skipping. */
    copyFilteredFiles: z.boolean(),
    encoder: encoderConfigSchema,
    deleteSource: z.boolean(),
    replaceOriginal: z.enum(['never', 'smaller', 'always']),
    customBatPath: z.string(),
    lowPriority: z.boolean(),
    saveWorkerLogs: z.boolean(),
    filters: z
      .object({
        include: propertyFilterSchema,
        exclude: propertyFilterSchema,
        size: sizeFilterSchema,
      })
      .strict(),
  })
  .strict();

export type WorkerItemConfig = z.infer<typeof workerItemConfigSchema>;

export type WorkerCommand =
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'configure';
      payload: WorkerSetup;
    }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'item';
      payload: WorkerItemConfig;
    }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'cancel-item';
      queueNumber: number;
    }
  | { v: typeof WORKER_PROTOCOL_VERSION; type: 'shutdown' };

const telemetrySchema = z
  .object({
    percent: z.number().finite().min(0).max(100).optional(),
    fps: z.number().finite().nonnegative().optional(),
    frame: z.number().finite().nonnegative().optional(),
    speed: z.number().finite().optional(),
    etaSeconds: z.number().finite().nonnegative().optional(),
    bytes: z.number().finite().nonnegative().optional(),
  })
  .strict();

export type WorkerTelemetry = z.infer<typeof telemetrySchema>;

export type WorkerEvent =
  | { v: typeof WORKER_PROTOCOL_VERSION; type: 'ready' }
  | { v: typeof WORKER_PROTOCOL_VERSION; type: 'request-item' }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'started';
      queueNumber: number;
    }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'progress';
      queueNumber: number;
      telemetry: WorkerTelemetry;
      raw: string;
    }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'file-sizes';
      queueNumber: number;
      sourceBytes: number;
      outputBytes: number;
    }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'result';
      queueNumber: number;
      state: WorkerResultState;
      detail: string;
      preset: string;
      /** Set for `excluded` results so the queue can show why. */
      reason?: string;
    }
  | {
      v: typeof WORKER_PROTOCOL_VERSION;
      type: 'console';
      level: 'info' | 'error';
      message: string;
    };

const v = z.literal(WORKER_PROTOCOL_VERSION);

const workerCommandSchema = z.discriminatedUnion('type', [
  z
    .object({ v, type: z.literal('configure'), payload: workerSetupSchema })
    .strict(),
  z
    .object({ v, type: z.literal('item'), payload: workerItemConfigSchema })
    .strict(),
  z
    .object({
      v,
      type: z.literal('cancel-item'),
      queueNumber: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ v, type: z.literal('shutdown') }).strict(),
]);

const workerEventSchema = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('ready') }).strict(),
  z.object({ v, type: z.literal('request-item') }).strict(),
  z
    .object({
      v,
      type: z.literal('started'),
      queueNumber: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('progress'),
      queueNumber: z.number().int().nonnegative(),
      telemetry: telemetrySchema,
      raw: z.string(),
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('file-sizes'),
      queueNumber: z.number().int().nonnegative(),
      sourceBytes: z.number().int().nonnegative(),
      outputBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('result'),
      queueNumber: z.number().int().nonnegative(),
      state: z.enum(WORKER_RESULT_STATES),
      detail: z.string(),
      preset: z.string(),
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('console'),
      level: z.enum(['info', 'error']),
      message: z.string(),
    })
    .strict(),
]);

export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Works with `strictNullChecks` disabled, where boolean discriminants collapse. */
export function decodeErrorMessage<T>(result: DecodeResult<T>): string {
  return 'error' in result ? result.error : '';
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function decodeWorkerCommand(raw: unknown): DecodeResult<WorkerCommand> {
  const parsed = workerCommandSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

export function decodeWorkerEvent(raw: unknown): DecodeResult<WorkerEvent> {
  const parsed = workerEventSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

export function decodeWorkerItem(raw: unknown): DecodeResult<WorkerItemConfig> {
  const parsed = workerItemConfigSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

export function decodeWorkerSetup(raw: unknown): DecodeResult<WorkerSetup> {
  const parsed = workerSetupSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type WorkerCommandPayload = DistributiveOmit<WorkerCommand, 'v'>;
export type WorkerEventPayload = DistributiveOmit<WorkerEvent, 'v'>;

export function toWorkerCommand(command: WorkerCommandPayload): WorkerCommand {
  return { ...command, v: WORKER_PROTOCOL_VERSION } as WorkerCommand;
}

export function toWorkerEvent(event: WorkerEventPayload): WorkerEvent {
  return { ...event, v: WORKER_PROTOCOL_VERSION } as WorkerEvent;
}

export function configureCommand(setup: WorkerSetup): WorkerCommand {
  return toWorkerCommand({ type: 'configure', payload: setup });
}

export function itemCommand(item: WorkerItemConfig): WorkerCommand {
  return toWorkerCommand({ type: 'item', payload: item });
}

export function cancelItemCommand(queueNumber: number): WorkerCommand {
  return toWorkerCommand({ type: 'cancel-item', queueNumber });
}

export function shutdownCommand(): WorkerCommand {
  return toWorkerCommand({ type: 'shutdown' });
}
