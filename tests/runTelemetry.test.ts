import { describe, expect, it } from 'vitest';
import {
  averageItemSeconds,
  completedWork,
  currentFps,
  estimateEtaSeconds,
  parsePercent,
  parseProgressText,
  processedBytes,
  windowRate,
} from '../src/common/runTelemetry';

describe('parsePercent', () => {
  it('reads percentages with or without a space', () => {
    expect(parsePercent('42.50%')).toBe(42.5);
    expect(parsePercent('12.34 %')).toBe(12.34);
    expect(parsePercent('done')).toBeUndefined();
  });

  it('clamps out-of-range values', () => {
    expect(parsePercent('140%')).toBe(100);
    expect(parsePercent('-3%')).toBe(0);
  });
});

describe('parseProgressText', () => {
  it('reads HandBrake progress lines', () => {
    expect(
      parseProgressText(
        'Encoding: task 1 of 1, 12.34 % (45.67 fps, avg 50.00 fps, ETA 00h01m02s)',
      ),
    ).toEqual({
      percent: 12.34,
      fps: 45.67,
      etaSeconds: 62,
    });
  });

  it('reads FFmpeg progress lines', () => {
    expect(
      parseProgressText(
        'frame= 1234 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate= 345.6kbits/s speed=1.2x',
      ),
    ).toEqual({
      fps: 45,
      frame: 1234,
      speed: 1.2,
      bytes: 1024 * 1024,
    });
  });

  it('accepts partial chunks and returns only what it found', () => {
    expect(parseProgressText('size=    2MiB')).toEqual({
      bytes: 2 * 1024 * 1024,
    });
    expect(parseProgressText('')).toEqual({});
    expect(parseProgressText(undefined)).toEqual({});
  });
});

const items = [
  {
    state: 'success',
    startedAt: 0,
    finishedAt: 10_000,
    sourceBytes: 100,
    outputBytes: 50,
  },
  {
    state: 'running',
    startedAt: 10_000,
    sourceBytes: 200,
    progress: { percent: 25, fps: 30 },
  },
  { state: 'pending', sourceBytes: 300 },
  { state: 'skipped' },
];

describe('run telemetry aggregates', () => {
  it('counts finished items and progress fractions as work', () => {
    expect(completedWork(items)).toBeCloseTo(2.25);
  });

  it('sums processed bytes without counting skipped items', () => {
    // the finished item counts fully, the running item a quarter of its source
    expect(processedBytes(items)).toBe(100 + 50);
  });

  it('adds up the fps of running items only', () => {
    expect(currentFps(items)).toBe(30);
  });

  it('averages terminal item durations', () => {
    expect(averageItemSeconds(items)).toBe(10);
  });
});

describe('estimateEtaSeconds', () => {
  it('uses measured throughput when available', () => {
    expect(
      estimateEtaSeconds({
        totalWork: 10,
        work: 4,
        workPerSecond: 2,
        averageItemSeconds: null,
        remainingItems: 6,
        workerCount: 2,
      }),
    ).toBe(3);
  });

  it('falls back to the average duration and worker count', () => {
    expect(
      estimateEtaSeconds({
        totalWork: 10,
        work: 4,
        workPerSecond: null,
        averageItemSeconds: 10,
        remainingItems: 6,
        workerCount: 3,
      }),
    ).toBe(20);
  });

  it('reports zero once nothing is left', () => {
    expect(
      estimateEtaSeconds({
        totalWork: 4,
        work: 4,
        workPerSecond: 1,
        averageItemSeconds: 10,
        remainingItems: 0,
        workerCount: 1,
      }),
    ).toBe(0);
  });
});

describe('windowRate', () => {
  const samples = [
    { at: 0, work: 0, bytes: 0, fps: 0 },
    { at: 5000, work: 5, bytes: 500, fps: 10 },
    { at: 10_000, work: 10, bytes: 1000, fps: 10 },
    { at: 30_000, work: 20, bytes: 2000, fps: 10 },
  ];

  it('measures change across the recent window', () => {
    expect(windowRate(samples, 30_000, (sample) => sample.work, 20_000)).toBe(
      0.5,
    );
  });

  it('returns null when there is not enough signal', () => {
    expect(windowRate(samples.slice(0, 1), 30_000, (sample) => sample.work)).toBeNull();
    expect(windowRate(samples, 30_000, (sample) => sample.fps)).toBe(0);
  });
});
