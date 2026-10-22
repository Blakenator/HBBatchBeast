import { describe, expect, it } from 'vitest';
import {
  evaluateSizeFilter,
  matchesExcludeFilter,
  matchesIncludeFilter,
  parseTelemetry,
  summarizeProbe,
} from '../src/backend/workers/media';

const probe = {
  streams: [
    { index: 0, codec_name: 'h264', codec_type: 'video', width: 1920, duration: '10', nb_frames: '100' },
    { index: 1, codec_name: 'aac', codec_type: 'audio', channels: 2 },
  ],
};

describe('property filters', () => {
  it('matches every include row in all mode', () => {
    expect(
      matchesIncludeFilter(probe, {
        mode: 'all',
        rows: [
          { key: 'codec_name', value: 'h264' },
          { key: 'width', value: '1920' },
        ],
      }),
    ).toBe(true);
    expect(
      matchesIncludeFilter(probe, {
        mode: 'all',
        rows: [
          { key: 'codec_name', value: 'h264' },
          { key: 'width', value: '1280' },
        ],
      }),
    ).toBe(false);
  });

  it('matches any include row in any mode', () => {
    expect(
      matchesIncludeFilter(probe, {
        mode: 'any',
        rows: [
          { key: 'codec_name', value: 'hevc' },
          { key: 'width', value: '1920' },
        ],
      }),
    ).toBe(true);
  });

  it('treats disabled filters as satisfied', () => {
    expect(matchesIncludeFilter(probe, { mode: 'off', rows: [] })).toBe(true);
    expect(matchesIncludeFilter(probe, { mode: 'all', rows: [] })).toBe(true);
  });

  it('excludes in any and all modes', () => {
    expect(
      matchesExcludeFilter(probe, {
        mode: 'any',
        rows: [{ key: 'codec_name', value: 'aac' }],
      }),
    ).toBe(true);
    expect(
      matchesExcludeFilter(probe, {
        mode: 'all',
        rows: [
          { key: 'codec_name', value: 'aac' },
          { key: 'channels', value: '6' },
        ],
      }),
    ).toBe(false);
    expect(
      matchesExcludeFilter(probe, {
        mode: 'all',
        rows: [
          { key: 'codec_name', value: 'aac' },
          { key: 'channels', value: '2' },
        ],
      }),
    ).toBe(true);
  });
});

describe('size filters', () => {
  it('uses decimal megabytes', () => {
    expect(evaluateSizeFilter(2_000_000, { minMb: 1, maxMb: 3 }).ok).toBe(true);
    expect(evaluateSizeFilter(500_000, { minMb: 1 })).toMatchObject({
      ok: false,
      reason: 'File below minimum MB size',
    });
    expect(evaluateSizeFilter(4_000_000, { maxMb: 3 })).toMatchObject({
      ok: false,
      reason: 'File above maximum MB size',
    });
  });
});

describe('probe summary', () => {
  it('reads frame count and duration from the first stream', () => {
    expect(summarizeProbe(probe)).toEqual({
      frameCount: 100,
      durationSeconds: 10,
    });
  });

  it('omits missing values', () => {
    expect(summarizeProbe({ streams: [{ codec_name: 'h264' }] })).toEqual({});
  });
});

describe('telemetry', () => {
  it('reads HandBrake percentages and timing fields', () => {
    expect(
      parseTelemetry(
        'Encoding: task 1 of 1, 42.50 % (45.7 fps, avg 50.0 fps, ETA 00h00m30s)',
        { encoder: 'handbrake' },
      ),
    ).toEqual({
      percent: 42.5,
      fps: 45.7,
      etaSeconds: 30,
    });
  });

  it('computes FFmpeg percentages from the probed frame count', () => {
    expect(
      parseTelemetry('frame= 25 fps=45 q=28.0 size=1024kB speed=1.2x', {
        encoder: 'ffmpeg',
        frameCount: 100,
      }),
    ).toEqual({
      percent: 25,
      fps: 45,
      frame: 25,
      speed: 1.2,
      bytes: 1024 * 1024,
    });
  });

  it('leaves FFmpeg percent undefined without a frame count', () => {
    const telemetry = parseTelemetry('frame= 25 fps=45', {
      encoder: 'ffmpeg',
    });
    expect(telemetry.percent).toBeUndefined();
    expect(telemetry.frame).toBe(25);
  });
});
