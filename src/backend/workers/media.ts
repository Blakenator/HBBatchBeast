import {
  parseProgressText,
  ParsedProgress,
} from '../../common/runTelemetry';
import { RawProbe, RawProbeStream, runFfprobe } from '../helpers/ffprobe';
import { WorkerTelemetry } from './protocol';

export type FilterMode = 'off' | 'any' | 'all';

export interface PropertyFilterConfig {
  mode: FilterMode;
  rows: { key: string; value: string }[];
}

export interface SizeFilterConfig {
  minMb?: number;
  maxMb?: number;
}

export interface ProbeSummary {
  frameCount?: number;
  durationSeconds?: number;
}

export function probeFile(filePath: string): Promise<RawProbe> {
  return runFfprobe(filePath);
}

export function summarizeProbe(info: RawProbe): ProbeSummary {
  const stream = info.streams?.[0];
  const frameCount = toFiniteNumber(stream?.nb_frames);
  const durationSeconds = toFiniteNumber(stream?.duration);
  return {
    ...(frameCount !== undefined ? { frameCount } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Property values are compared as strings, so `width: 1920` matches a number. */
function streamMatches(
  streams: RawProbeStream[],
  row: { key: string; value: string },
): boolean {
  return streams.some(
    (stream) =>
      Object.prototype.hasOwnProperty.call(stream, row.key) &&
      String(stream[row.key]) === row.value,
  );
}

/** True when the include filter is satisfied (or disabled). */
export function matchesIncludeFilter(
  info: RawProbe,
  filter: PropertyFilterConfig,
): boolean {
  if (filter.mode === 'off' || filter.rows.length === 0) return true;
  const streams = info.streams ?? [];
  const matches = filter.rows.map((row) => streamMatches(streams, row));
  return filter.mode === 'all' ? matches.every(Boolean) : matches.some(Boolean);
}

/** True when the exclude filter removes the file. */
export function matchesExcludeFilter(
  info: RawProbe,
  filter: PropertyFilterConfig,
): boolean {
  if (filter.mode === 'off' || filter.rows.length === 0) return false;
  const streams = info.streams ?? [];
  const matches = filter.rows.map((row) => streamMatches(streams, row));
  return filter.mode === 'all' ? matches.every(Boolean) : matches.some(Boolean);
}

export interface SizeEvaluation {
  ok: boolean;
  reason?: string;
  sizeBytes?: number;
}

/** Sizes use decimal megabytes, matching the config's "MB" label. */
export function evaluateSizeFilter(
  sizeBytes: number,
  filter: SizeFilterConfig,
): SizeEvaluation {
  const sizeMb = sizeBytes / 1_000_000;
  if (filter.minMb !== undefined && sizeMb < filter.minMb) {
    return { ok: false, reason: 'File below minimum MB size', sizeBytes };
  }
  if (filter.maxMb !== undefined && sizeMb > filter.maxMb) {
    return { ok: false, reason: 'File above maximum MB size', sizeBytes };
  }
  return { ok: true, sizeBytes };
}

export interface TelemetryOptions {
  encoder: 'handbrake' | 'ffmpeg';
  frameCount?: number;
}

/**
 * Extracts progress from one encoder chunk. FFmpeg reports frames without a
 * percentage, so the probed frame count supplies the denominator.
 */
export function parseTelemetry(
  chunk: string,
  options: TelemetryOptions,
): WorkerTelemetry {
  const parsed: ParsedProgress = parseProgressText(chunk);
  const telemetry: WorkerTelemetry = {};

  if (options.encoder === 'handbrake') {
    if (parsed.percent !== undefined) telemetry.percent = parsed.percent;
  } else if (parsed.frame !== undefined && options.frameCount) {
    const percent = (parsed.frame / options.frameCount) * 100;
    telemetry.percent = Math.min(100, Math.max(0, Number(percent.toFixed(2))));
  }

  if (parsed.fps !== undefined) telemetry.fps = parsed.fps;
  if (parsed.frame !== undefined) telemetry.frame = parsed.frame;
  if (parsed.speed !== undefined) telemetry.speed = parsed.speed;
  if (parsed.etaSeconds !== undefined) telemetry.etaSeconds = parsed.etaSeconds;
  if (parsed.bytes !== undefined) telemetry.bytes = parsed.bytes;

  return telemetry;
}

export function hasTelemetry(telemetry: WorkerTelemetry): boolean {
  return Object.keys(telemetry).length > 0;
}
