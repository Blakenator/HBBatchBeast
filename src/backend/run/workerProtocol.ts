/**
 * Boundary between the main process and `worker1`.
 *
 * `worker1` predates the typed protocol and emits positional arrays tagged by a
 * string in slot 1. Rather than rewriting ~200 send sites at once, the parent
 * translates them here into typed events. New worker code should emit typed
 * envelopes instead; this module is the single place that understands the old
 * shapes.
 */

export interface WorkerItemConfig {
  queueNumber: number;
  skipOrCopy: number;
  copyOnOff: boolean;
  replaceOriginalFile: boolean;
  moveCorruptFileOnOff: boolean;
  corruptDestinationPath: string;
  mode: string;
  itemChecked: boolean;
  fileFiltersInclude: string;
  fileFiltersExclude: string;
  replaceOriginalFileAlways: boolean;
  includeAnyProperties: boolean;
  includeAllProperties: boolean;
  excludeAnyProperties: boolean;
  excludeAllProperties: boolean;
  handBrakeMode: boolean;
  ffmpegMode: boolean;
  deleteSourceFiles: boolean;
  customBatOn: boolean;
  tempFolderSelected: boolean;
  sourcePath: string;
  preset: string;
  destinationPath: string;
  destinationFinalPath: string;
  minFileSizeOnOff: boolean;
  minFileSize: string;
  maxFileSizeOnOff: boolean;
  maxFileSize: string;
  thoroughHealthCheck: boolean;
  repairFile: boolean;
  repairCrfValue: string;
  handBrakeCliPath: string;
  ffmpegPath: string;
  saveWorkerLogs: boolean;
  /** GUI preset files HandBrakeCLI must import to resolve custom `-Z` names. */
  handBrakePresetImportFiles: string[];
}

export type WorkerItemState =
  | 'OK'
  | 'Fail'
  | 'Skip'
  | 'Copy'
  | 'cancelled'
  | 'error';

export type WorkerEvent =
  | { worker: number; type: 'queueRequest' }
  | { worker: number; type: 'console'; message: string }
  | { worker: number; type: 'started'; queueNumber: number }
  | {
      worker: number;
      type: 'progress';
      queueNumber: number;
      percent: string;
      /** Encoder line the percentage came from (HandBrake/FFmpeg telemetry). */
      raw?: string;
    }
  | {
      worker: number;
      type: 'fileSizes';
      queueNumber: number;
      sourceBytes: number;
      outputBytes: number;
    }
  | {
      worker: number;
      type: 'probe';
      queueNumber: number;
      ok: boolean;
      sourcePath: string;
    }
  | {
      worker: number;
      type: 'result';
      queueNumber: number;
      state: WorkerItemState;
      preset: string;
      detail: string;
    }
  | { worker: number; type: 'logAppend'; filePath: string; text: string }
  | { worker: number; type: 'exitRequest' };

/**
 * worker1 is inconsistent about where it puts the outcome: some messages carry
 * it in slot 3 (`['copied', n, 'Copy', log]`), others use the tag itself
 * (`['success', n, preset, detail]`). Both are handled here.
 */
const STATE_TOKENS: Record<string, WorkerItemState> = {
  OK: 'OK',
  Fail: 'Fail',
  Skip: 'Skip',
  Copy: 'Copy',
  cancelled: 'cancelled',
};

const RESULT_TAGS: Record<string, WorkerItemState> = {
  OK: 'OK',
  success: 'OK',
  Fail: 'Fail',
  Skip: 'Skip',
  Copy: 'Copy',
  cancelled: 'cancelled',
  error: 'error',
  'Unable to repair file': 'error',
};

function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function toWorkerNumber(raw: unknown): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWorkerEvent(raw: unknown): WorkerEvent | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const worker = toWorkerNumber(raw[0]);
  const tag = asString(raw[1]);

  if (tag === 'queueRequest') return { worker, type: 'queueRequest' };
  if (tag === 'consoleMessage') {
    return { worker, type: 'console', message: asString(raw[2]) };
  }
  if (tag === 'processing') {
    return { worker, type: 'started', queueNumber: toWorkerNumber(raw[2]) };
  }
  if (tag === 'percentage') {
    const rawLine = asString(raw[4]);
    return {
      worker,
      type: 'progress',
      queueNumber: toWorkerNumber(raw[2]),
      percent: asString(raw[3]),
      ...(rawLine ? { raw: rawLine } : {}),
    };
  }
  if (tag === 'fileSizes') {
    // worker1 reports sizes in gigabytes; normalize them to bytes.
    const gigabytes = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.round(parsed * 1e9) : 0;
    };
    return {
      worker,
      type: 'fileSizes',
      queueNumber: toWorkerNumber(raw[2]),
      sourceBytes: gigabytes(raw[3]),
      outputBytes: gigabytes(raw[4]),
    };
  }
  if (tag === 'FFPROBE') {
    return {
      worker,
      type: 'probe',
      queueNumber: toWorkerNumber(raw[2]),
      ok: asString(raw[3]) === 'OK',
      sourcePath: asString(raw[4]),
    };
  }
  if (tag === 'appendRequest') {
    return {
      worker,
      type: 'logAppend',
      filePath: asString(raw[2]),
      text: asString(raw[3]),
    };
  }
  if (tag === 'exitRequest') return { worker, type: 'exitRequest' };

  const state = STATE_TOKENS[asString(raw[3])] ?? RESULT_TAGS[tag];
  if (state) {
    const presetFromSlot = asString(raw[3]);
    return {
      worker,
      type: 'result',
      queueNumber: toWorkerNumber(raw[2]),
      state,
      // slot 3 holds the outcome token for Skip/Copy, the preset otherwise
      preset: STATE_TOKENS[presetFromSlot] ? '' : presetFromSlot,
      detail: asString(raw[4]),
    };
  }

  return null;
}

/**
 * Encodes a worker item for `worker1`, which still reads a positional array
 * (see `m[0] == 'queueNumber'`). Keeping the encoding here means the rest of the
 * app never touches slot indices.
 */
export function encodeWorkerItem(config: WorkerItemConfig): unknown[] {
  return [
    'queueNumber',
    config.queueNumber,
    config.skipOrCopy,
    config.copyOnOff,
    config.replaceOriginalFile,
    config.moveCorruptFileOnOff,
    config.corruptDestinationPath,
    config.mode,
    undefined, // historically the queue mode; superseded by `mode`
    config.itemChecked,
    config.fileFiltersInclude,
    config.fileFiltersExclude,
    config.replaceOriginalFileAlways,
    config.includeAnyProperties,
    config.includeAllProperties,
    config.excludeAnyProperties,
    config.excludeAllProperties,
    config.handBrakeMode,
    config.ffmpegMode,
    config.deleteSourceFiles,
    config.customBatOn,
    config.tempFolderSelected,
    config.sourcePath,
    config.preset,
    config.destinationPath,
    config.destinationFinalPath,
    config.minFileSizeOnOff,
    config.minFileSize,
    config.maxFileSizeOnOff,
    config.maxFileSize,
    config.thoroughHealthCheck,
    config.repairFile,
    config.repairCrfValue,
    config.handBrakeCliPath,
    config.ffmpegPath,
    config.saveWorkerLogs,
    config.handBrakePresetImportFiles,
  ];
}
