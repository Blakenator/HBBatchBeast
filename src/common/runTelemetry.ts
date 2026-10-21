/**
 * Progress telemetry shared by the main process (which parses worker output)
 * and the renderer (which turns per-item progress into rates and an ETA).
 *
 * Worker output is not one format: HandBrakeCLI prints
 * `12.34 % (45.7 fps, avg 50.0 fps, ETA 00h01m02s)` while FFmpeg prints
 * `frame= 123 fps=45 q=28.0 size= 1024kB time=... speed=1.2x`. Both are
 * best-effort: a chunk can be a partial line, so every field is optional.
 */

export interface ParsedProgress {
  percent?: number;
  fps?: number;
  speed?: number;
  etaSeconds?: number;
  frame?: number;
  bytes?: number;
}

export interface RunItemProgress {
  percent?: number;
  fps?: number;
  speed?: number;
  etaSeconds?: number;
  frame?: number;
  /** Output size reported by FFmpeg for the chunk in flight. */
  bytes?: number;
}

const NUMBER = '([0-9]+(?:\\.[0-9]+)?)';

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads the numeric value out of a worker percentage such as `42.50%`. */
export function parsePercent(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /(-?[0-9]+(?:[.,][0-9]+)?)\s*%/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(0, parsed));
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  bytes: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 * 1024,
  mib: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
};

function parseSize(value: string, unit: string): number | undefined {
  const amount = toNumber(value);
  const multiplier = SIZE_UNITS[unit.toLowerCase()];
  if (amount === undefined || multiplier === undefined) return undefined;
  return Math.round(amount * multiplier);
}

/**
 * Extracts the interesting numbers from one line of encoder output. Fields
 * absent from the line are simply omitted so callers can merge over the last
 * known values (percent does not change on every `fps=` line).
 */
export function parseProgressText(text?: string): ParsedProgress {
  if (!text) return {};

  const parsed: ParsedProgress = {};
  const percent = new RegExp('-?' + NUMBER + '\\s*%').exec(text);
  if (percent) {
    const value = toNumber(percent[1]);
    if (value !== undefined) {
      parsed.percent = Math.min(100, Math.max(0, value));
    }
  }

  // FFmpeg writes `fps=45`; HandBrake writes `45.7 fps` (and `avg 50.0 fps`).
  const fps =
    new RegExp('fps=\\s*' + NUMBER).exec(text) ??
    new RegExp(NUMBER + '\\s*fps').exec(text);
  if (fps) parsed.fps = toNumber(fps[1]);

  const frame = new RegExp('frame=\\s*' + NUMBER).exec(text);
  if (frame) parsed.frame = toNumber(frame[1]);

  const speed = new RegExp('speed=\\s*' + NUMBER + 'x').exec(text);
  if (speed) parsed.speed = toNumber(speed[1]);

  if (text.includes('ETA')) {
    const eta = new RegExp('ETA\\s+(?:([0-9]+)h)?([0-9]+)m([0-9]+)s').exec(text);
    if (eta) {
      const hours = toNumber(eta[1]) ?? 0;
      const minutes = toNumber(eta[2]) ?? 0;
      const seconds = toNumber(eta[3]) ?? 0;
      parsed.etaSeconds = hours * 3600 + minutes * 60 + seconds;
    }
  }

  const size = new RegExp(
    'size=\\s*' + NUMBER + '\\s*(k?i?B|m?i?B|g?i?B|bytes)',
    'i',
  ).exec(text);
  if (size) parsed.bytes = parseSize(size[1], size[2]);

  return parsed;
}

/** Item fields telemetry needs; structural so both processes can pass items. */
export interface TelemetryItem {
  state: string;
  startedAt?: number;
  finishedAt?: number;
  sourceBytes?: number;
  outputBytes?: number;
  progress?: RunItemProgress;
}

const TERMINAL_STATES = new Set([
  'success',
  'error',
  'cancelled',
  'skipped',
]);

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

function itemFraction(item: TelemetryItem): number {
  if (isTerminalState(item.state)) return 1;
  const percent = item.progress?.percent;
  if (percent === undefined) return 0;
  return Math.min(1, Math.max(0, percent / 100));
}

/**
 * Work completed in "file units": finished items count as one and each running
 * item contributes its progress fraction. This keeps the ETA meaningful while a
 * single large file is the only thing left.
 */
export function completedWork(items: readonly TelemetryItem[]): number {
  let work = 0;
  for (const item of items) work += itemFraction(item);
  return work;
}

/**
 * Bytes of source processed so far. Uses the source size (input consumed) so
 * the series is monotonic; converted sizes are reported separately per item.
 */
export function processedBytes(items: readonly TelemetryItem[]): number {
  let bytes = 0;
  for (const item of items) {
    if (item.state === 'skipped') continue;
    bytes += (item.sourceBytes ?? 0) * itemFraction(item);
  }
  return bytes;
}

/** Combined frames per second reported by the running items. */
export function currentFps(items: readonly TelemetryItem[]): number {
  let fps = 0;
  for (const item of items) {
    if (item.state === 'running' && item.progress?.fps) {
      fps += item.progress.fps;
    }
  }
  return fps;
}

export function knownSourceBytes(items: readonly TelemetryItem[]): number {
  return items.reduce((sum, item) => sum + (item.sourceBytes ?? 0), 0);
}

export interface RateSample {
  at: number;
  work: number;
  bytes: number;
  fps: number;
}

/**
 * Work per second between the first and last sample in the window. Using a
 * window smooths the bursty per-item updates into a stable ETA.
 */
export function windowRate(
  samples: readonly RateSample[],
  now: number,
  pick: (sample: RateSample) => number,
  windowMs = 20_000,
): number | null {
  const recent = samples.filter((sample) => sample.at >= now - windowMs);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const seconds = (last.at - first.at) / 1000;
  if (seconds < 1) return null;
  return (pick(last) - pick(first)) / seconds;
}

export interface EtaInput {
  totalWork: number;
  work: number;
  workPerSecond: number | null;
  averageItemSeconds: number | null;
  remainingItems: number;
  workerCount: number;
}

/**
 * Prefers measured throughput and falls back to the average duration of the
 * items that already finished (useful right after a pause or a slow first file).
 */
export function estimateEtaSeconds(input: EtaInput): number | null {
  const remaining = Math.max(0, input.totalWork - input.work);
  if (remaining === 0) return 0;
  if (input.workPerSecond !== null && input.workPerSecond > 0) {
    return remaining / input.workPerSecond;
  }
  if (input.averageItemSeconds !== null && input.averageItemSeconds > 0) {
    return (
      (input.remainingItems * input.averageItemSeconds) /
      Math.max(1, input.workerCount)
    );
  }
  return null;
}

/** Average wall-clock duration of items that reached a terminal state. */
export function averageItemSeconds(
  items: readonly TelemetryItem[],
): number | null {
  let total = 0;
  let count = 0;
  for (const item of items) {
    if (!isTerminalState(item.state)) continue;
    if (item.startedAt === undefined || item.finishedAt === undefined) continue;
    const seconds = (item.finishedAt - item.startedAt) / 1000;
    if (seconds < 0) continue;
    total += seconds;
    count += 1;
  }
  return count === 0 ? null : total / count;
}
