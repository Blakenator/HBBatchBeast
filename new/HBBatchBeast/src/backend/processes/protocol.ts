/**
 * Typed message protocol between the main process and its child-process modules.
 *
 * The legacy modules exchanged positional arrays with magic indices, which made
 * a wrong index silently produce wrong data (see MIGRATION_STATUS.md D1). Every
 * message here is a discriminated union with an explicit protocol version so a
 * mismatch fails loudly instead of corrupting a run.
 */

export const PROTOCOL_VERSION = 1;

export type ChildLogLevel = 'info' | 'error';

export interface QueueBuildConfig {
  sources: string[];
  destinations: string[];
  tempDestinations: string[];
  useTempFolder: boolean;
  includedFileTypes: string;
  container: string;
  mode: string;
  presets: string[];
  titleWordFilter: string;
  replaceIfSmaller: boolean;
  fileSuffixes: string[];
  removeApostrophes: boolean;
  replaceAlways: boolean;
  reverseQueue: boolean;
}

export interface QueueBuildResult {
  total: number;
  sources: string[];
  presets: string[];
  skipOrCopy: number[];
  destinations: (string | null)[];
  destinationsFinal: (string | null)[];
  notExists: number;
}

export type ChildMessage =
  | { v: number; type: 'ready' }
  | { v: number; type: 'log'; level: ChildLogLevel; message: string }
  | {
      v: number;
      type: 'progress';
      phase: 'discovered' | 'queued';
      count: number;
    }
  | { v: number; type: 'complete'; payload: QueueBuildResult }
  | { v: number; type: 'error'; message: string; stack?: string };

export type ParentMessage =
  | { v: number; type: 'configure'; payload: QueueBuildConfig }
  | { v: number; type: 'shutdown' };

/** Returns null for anything that is not a well-formed, current-version message. */
export function parseChildMessage(raw: unknown): ChildMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION || typeof message.type !== 'string') {
    return null;
  }

  switch (message.type) {
    case 'ready':
      return message as unknown as ChildMessage;
    case 'log':
      return typeof message.message === 'string'
        ? (message as unknown as ChildMessage)
        : null;
    case 'progress':
      return typeof message.count === 'number' &&
        (message.phase === 'discovered' || message.phase === 'queued')
        ? (message as unknown as ChildMessage)
        : null;
    case 'complete':
      return typeof message.payload === 'object' && message.payload !== null
        ? (message as unknown as ChildMessage)
        : null;
    case 'error':
      return typeof message.message === 'string'
        ? (message as unknown as ChildMessage)
        : null;
    default:
      return null;
  }
}
