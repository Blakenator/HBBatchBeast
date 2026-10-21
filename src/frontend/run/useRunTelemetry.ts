import { useEffect, useMemo, useState } from 'react';
import {
  averageItemSeconds,
  completedWork,
  currentFps,
  estimateEtaSeconds,
  isTerminalState,
  processedBytes,
  RateSample,
  TelemetryItem,
  windowRate,
} from '../../common/runTelemetry';
import { RunStatePayload } from './types';

/** How often one progress sample is kept for the speed history. */
const SAMPLE_INTERVAL_MS = 400;
const SAMPLE_WINDOW_MS = 20_000;
const MAX_SAMPLES = 240;
/** No progress for this long while running reads as stalled, not as a bad ETA. */
const STALL_MS = 15_000;
const MAX_POINTS = 60;

export interface SpeedPoint {
  at: number;
  filesPerMinute: number;
  bytesPerSecond: number;
  fps: number;
}

export interface RunTelemetry {
  work: number;
  total: number;
  fraction: number;
  processedBytes: number;
  knownBytes: number;
  fps: number | null;
  filesPerMinute: number | null;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  finishAt: number | null;
  elapsedSeconds: number;
  stalled: boolean;
  points: SpeedPoint[];
}

function buildPoints(samples: readonly RateSample[]): SpeedPoint[] {
  const points: SpeedPoint[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const seconds = (current.at - previous.at) / 1000;
    if (seconds <= 0) continue;
    points.push({
      at: current.at,
      filesPerMinute: Math.max(
        0,
        ((current.work - previous.work) / seconds) * 60,
      ),
      bytesPerSecond: Math.max(
        0,
        (current.bytes - previous.bytes) / seconds,
      ),
      fps: current.fps,
    });
  }
  return points.slice(-MAX_POINTS);
}

function lastProgressAt(samples: readonly RateSample[], fallback: number): number {
  for (let index = samples.length - 1; index > 0; index -= 1) {
    if (samples[index].work > samples[index - 1].work) {
      return samples[index].at;
    }
  }
  return samples.length > 0 ? samples[0].at : fallback;
}

/**
 * Turns the progress stream into chart history and an ETA. Samples are kept in
 * renderer state rather than the run payload so a 10k-item run does not grow
 * with every progress tick.
 */
export function useRunTelemetry(state?: RunStatePayload): RunTelemetry {
  const [samples, setSamples] = useState<RateSample[]>([]);
  const [tick, setTick] = useState(0);
  const runKey = state?.startedAt ?? null;
  const running = state?.status === 'running';

  // A new run starts a new history.
  useEffect(() => {
    setSamples([]);
  }, [runKey]);

  useEffect(() => {
    if (!state || state.status === 'idle') return;
    const items = state.items as unknown as TelemetryItem[];
    const now = Date.now();
    const sample: RateSample = {
      at: now,
      work: completedWork(items),
      bytes: processedBytes(items),
      fps: currentFps(items),
    };
    setSamples((previous) => {
      const last = previous[previous.length - 1];
      if (last && now - last.at < SAMPLE_INTERVAL_MS) return previous;
      const next = [...previous, sample];
      return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
    });
  }, [state]);

  // The stream can go quiet between files; keep elapsed/stall labels live.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return useMemo(() => {
    const now = Date.now();
    const items = (state?.items ?? []) as unknown as TelemetryItem[];
    const total = state?.counts.total ?? 0;
    const work = completedWork(items);
    const bytes = processedBytes(items);
    const measuredWorkRate = windowRate(samples, now, (sample) => sample.work, SAMPLE_WINDOW_MS);
    const measuredByteRate = windowRate(samples, now, (sample) => sample.bytes, SAMPLE_WINDOW_MS);
    const remainingItems = items.filter((item) => !isTerminalState(item.state)).length;
    const etaSeconds = estimateEtaSeconds({
      totalWork: total,
      work,
      workPerSecond: measuredWorkRate,
      averageItemSeconds: averageItemSeconds(items),
      remainingItems,
      workerCount: state?.workerCount ?? 1,
    });
    const progressAt = lastProgressAt(samples, state?.startedAt ?? now);
    const stalled = running && now - progressAt > STALL_MS;
    const elapsedSeconds = state?.startedAt
      ? Math.max(
          0,
          Math.round(((state.finishedAt ?? now) - state.startedAt) / 1000),
        )
      : 0;
    const fps = currentFps(items);

    return {
      work,
      total,
      fraction: total > 0 ? Math.min(1, work / total) : 0,
      processedBytes: bytes,
      knownBytes: items.reduce((sum, item) => sum + (item.sourceBytes ?? 0), 0),
      fps: fps > 0 ? fps : null,
      filesPerMinute:
        measuredWorkRate === null ? null : Math.max(0, measuredWorkRate * 60),
      bytesPerSecond:
        measuredByteRate === null ? null : Math.max(0, measuredByteRate),
      etaSeconds: stalled ? null : etaSeconds,
      finishAt:
        etaSeconds === null || stalled ? null : now + etaSeconds * 1000,
      elapsedSeconds,
      stalled,
      points: buildPoints(samples),
    };
  }, [state, samples, running, tick]);
}
