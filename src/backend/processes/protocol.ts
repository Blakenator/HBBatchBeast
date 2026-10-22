import { z } from 'zod';

/**
 * Typed message protocol between the main process and its child-process modules.
 *
 * Every message is a discriminated union validated with zod. A version or shape
 * mismatch fails loudly instead of producing plausible-but-wrong data from the
 * wrong positional slot.
 */

export const PROTOCOL_VERSION = 1;

export const BATCH_OPERATION_MODES = ['scanOnly', 'scanAndConvert'] as const;

export type ChildLogLevel = 'info' | 'error';

const v = z.literal(PROTOCOL_VERSION);

const queueBuildConfigSchema = z
  .object({
    sources: z.array(z.string().min(1)).min(1),
    destinations: z.array(z.string().min(1)),
    tempDestinations: z.array(z.string()),
    useTempFolder: z.boolean(),
    includedFileTypes: z.string(),
    container: z.string().min(1),
    mode: z.enum(BATCH_OPERATION_MODES),
    presets: z.array(z.string()),
    titleWordFilter: z.string(),
    replaceIfSmaller: z.boolean(),
    fileSuffixes: z.array(z.string()),
    removeApostrophes: z.boolean(),
    replaceAlways: z.boolean(),
    reverseQueue: z.boolean(),
    /** Logs directory; used for the replaced-originals cache. */
    logDirectory: z.string().min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const checkLength = (
      name: 'destinations' | 'presets' | 'fileSuffixes' | 'tempDestinations',
      expected: number,
    ) => {
      if (config[name].length !== expected) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `must contain ${expected} entries to match sources`,
        });
      }
    };

    checkLength('destinations', config.sources.length);
    checkLength('presets', config.sources.length);
    checkLength('fileSuffixes', config.sources.length);
    if (config.useTempFolder) {
      checkLength('tempDestinations', config.sources.length);
    }
  });

export type QueueBuildConfig = z.infer<typeof queueBuildConfigSchema>;

const queueBuildResultSchema = z
  .object({
    total: z.number().int().nonnegative(),
    sources: z.array(z.string()),
    presets: z.array(z.string()),
    // Sparse legacy arrays serialize holes as null; treat null as "not flagged".
    skipOrCopy: z.array(z.union([z.literal(0), z.literal(1), z.null()])),
    destinations: z.array(z.string().nullable()),
    destinationsFinal: z.array(z.string().nullable()),
    notExists: z.number().int().nonnegative(),
  })
  .strict();

export type QueueBuildResult = z.infer<typeof queueBuildResultSchema>;

export type ChildMessage =
  | { v: typeof PROTOCOL_VERSION; type: 'ready' }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'log';
      level: ChildLogLevel;
      message: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'progress';
      phase: 'discovered' | 'queued';
      count: number;
    }
  | { v: typeof PROTOCOL_VERSION; type: 'complete'; payload: QueueBuildResult }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'error';
      message: string;
      stack?: string;
    };

export type ParentMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'configure';
      payload: QueueBuildConfig;
    }
  | { v: typeof PROTOCOL_VERSION; type: 'shutdown' };

const childMessageSchema = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('ready') }).strict(),
  z
    .object({
      v,
      type: z.literal('log'),
      level: z.enum(['info', 'error']),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('progress'),
      phase: z.enum(['discovered', 'queued']),
      count: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('complete'),
      payload: queueBuildResultSchema,
    })
    .strict(),
  z
    .object({
      v,
      type: z.literal('error'),
      message: z.string(),
      stack: z.string().optional(),
    })
    .strict(),
]);

const parentMessageSchema = z.discriminatedUnion('type', [
  z
    .object({ v, type: z.literal('configure'), payload: queueBuildConfigSchema })
    .strict(),
  z.object({ v, type: z.literal('shutdown') }).strict(),
]);

export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Child message without the protocol version; `toChildMessage` adds it. */
export type ChildMessagePayload = DistributiveOmit<ChildMessage, 'v'>;

export function toChildMessage(message: ChildMessagePayload): ChildMessage {
  return { ...message, v: PROTOCOL_VERSION } as ChildMessage;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function decodeQueueBuildConfig(
  raw: unknown,
): DecodeResult<QueueBuildConfig> {
  const parsed = queueBuildConfigSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

export function decodeChildMessage(raw: unknown): DecodeResult<ChildMessage> {
  const parsed = childMessageSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

export function decodeParentMessage(raw: unknown): DecodeResult<ParentMessage> {
  const parsed = parentMessageSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: formatIssues(parsed.error) };
}

/** Returns null for anything that is not a well-formed, current-version message. */
export function parseChildMessage(raw: unknown): ChildMessage | null {
  const decoded = decodeChildMessage(raw);
  return decoded.ok ? decoded.value : null;
}

export function parseParentMessage(raw: unknown): ParentMessage | null {
  const decoded = decodeParentMessage(raw);
  return decoded.ok ? decoded.value : null;
}

export function parseQueueBuildConfig(raw: unknown): QueueBuildConfig | null {
  const decoded = decodeQueueBuildConfig(raw);
  return decoded.ok ? decoded.value : null;
}
