import { describe, expect, it } from 'vitest';
import {
  averageItemSeconds,
  completedWork,
  currentFps,
  estimateEtaSeconds,
  parsePercent,
  parseProgressText,
  processedBytes,
  summarizeSizeChanges,
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

describe('summarizeSizeChanges', () => {
  it('totals before/after sizes and signed deltas for successful items', () => {
    const summary = summarizeSizeChanges([
      { path: '/media/a.mkv', state: 'success', sourceBytes: 1000, outputBytes: 600 },
      { path: '/media/b.mkv', state: 'success', sourceBytes: 500, outputBytes: 750 },
      { path: '/media/c.mkv', state: 'skipped', sourceBytes: 100, outputBytes: 100 },
      { path: '/media/d.mkv', state: 'error', sourceBytes: 100, outputBytes: 50 },
      { path: '/media/e.mkv', state: 'success', sourceBytes: 100 },
    ]);

    expect(summary.files).toBe(2);
    expect(summary.expectedFiles).toBe(0);
    expect(summary.beforeBytes).toBe(1500);
    expect(summary.afterBytes).toBe(1350);
    expect(summary.deltaBytes).toBe(-150);
    expect(summary.percent).toBeCloseTo(-10);
    expect(summary.points).toEqual([
      {
        path: '/media/a.mkv',
        beforeBytes: 1000,
        afterBytes: 600,
        writtenBytes: 600,
        deltaBytes: -400,
        percent: -40,
        expected: false,
      },
      {
        path: '/media/b.mkv',
        beforeBytes: 500,
        afterBytes: 750,
        writtenBytes: 750,
        deltaBytes: 250,
        percent: 50,
        expected: false,
      },
    ]);
  });

  it('reports an increase when outputs are larger', () => {
    const summary = summarizeSizeChanges([
      { path: '/media/a.mkv', state: 'success', sourceBytes: 200, outputBytes: 500 },
    ]);

    expect(summary.deltaBytes).toBe(300);
    expect(summary.percent).toBe(150);
  });

  it('extrapolates final size for running items from bytes and percent', () => {
    const summary = summarizeSizeChanges([
      { path: '/media/done.mkv', state: 'success', sourceBytes: 1000, outputBytes: 500 },
      {
        path: '/media/live.mkv',
        state: 'running',
        sourceBytes: 2000,
        writtenBytes: 400,
        progress: { percent: 25 },
      },
      {
        path: '/media/early.mkv',
        state: 'running',
        sourceBytes: 1000,
        writtenBytes: 100,
      },
    ]);

    expect(summary.files).toBe(1);
    expect(summary.expectedFiles).toBe(1);
    expect(summary.beforeBytes).toBe(1000);
    expect(summary.afterBytes).toBe(500);
    expect(summary.expectedBeforeBytes).toBe(3000);
    expect(summary.expectedAfterBytes).toBe(2100);
    expect(summary.expectedPercent).toBeCloseTo(-30);
    expect(summary.points[1]).toEqual({
      path: '/media/live.mkv',
      beforeBytes: 2000,
      afterBytes: 1600,
      writtenBytes: 400,
      deltaBytes: -400,
      percent: -20,
      expected: true,
    });
  });

  it('ignores running items without a usable percentage', () => {
    const summary = summarizeSizeChanges([
      {
        path: '/media/live.mkv',
        state: 'running',
        sourceBytes: 1000,
        writtenBytes: 500,
        progress: { percent: 200 },
      },
    ]);

    expect(summary.expectedFiles).toBe(0);
    expect(summary.points).toEqual([]);
  });

  it('returns an empty summary when no item has both sizes', () => {
    const summary = summarizeSizeChanges([
      { path: '/media/a.mkv', state: 'success', sourceBytes: 0, outputBytes: 100 },
      { path: '/media/b.mkv', state: 'running', sourceBytes: 100, outputBytes: 100 },
      { path: '/media/c.mkv', state: 'success' },
    ]);

    expect(summary).toEqual({
      files: 0,
      expectedFiles: 0,
      beforeBytes: 0,
      afterBytes: 0,
      deltaBytes: 0,
      percent: null,
      expectedBeforeBytes: 0,
      expectedAfterBytes: 0,
      expectedDeltaBytes: 0,
      expectedPercent: null,
      points: [],
    });
  });
});
