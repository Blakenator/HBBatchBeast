import { describe, expect, it, vi } from 'vitest';
import {
  detectBlackIntervals,
  parseBlackDetectOutput,
} from '../src/backend/organizer/split/blackFrames';

const output = [
  '[blackdetect @ 0x55d0] black_start:15.4 black_end:17.2 black_duration:1.8',
  '[blackdetect @ 0x55d0] black_start:40 black_end:41 black_duration:1',
].join('\n');

describe('parseBlackDetectOutput', () => {
  it('reads every black run and normalizes the video start offset', () => {
    expect(parseBlackDetectOutput(output, 5.4)).toEqual([
      { startSeconds: 10, endSeconds: 11.8 },
      { startSeconds: 34.6, endSeconds: 35.6 },
    ]);
  });

  it('ignores malformed or inverted runs', () => {
    expect(
      parseBlackDetectOutput(
        'black_start:7 black_end:7 black_duration:0\n' +
          'black_start:nope black_end:8 black_duration:1',
      ),
    ).toEqual([]);
  });
});

describe('detectBlackIntervals', () => {
  it('runs blackdetect against the configured executable', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: output }));
    const intervals = await detectBlackIntervals(
      '/media/tv/episode.mkv',
      {
        executable: '/opt/ffmpeg',
        startTimeSeconds: 5.4,
        minDurationSeconds: 0.5,
        pixelThreshold: 0.12,
      },
      { runFfmpeg: run },
    );

    expect(intervals).toHaveLength(2);
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining([
        '-i',
        '/media/tv/episode.mkv',
        '-vf',
        'blackdetect=d=0.5:pix_th=0.12',
        '-f',
        'null',
        '-',
      ]),
      expect.objectContaining({ executable: '/opt/ffmpeg' }),
    );
    // Without a progress callback the scan stays quiet and fast.
    const args = run.mock.calls[0]?.[0] as string[];
    expect(args).not.toContain('-progress');
    expect(
      (run.mock.calls[0]?.[1] as { onProgress?: unknown }).onProgress,
    ).toBeUndefined();
  });

  it('streams ffmpeg out-time to the progress callback', async () => {
    let report: ((progress: { outTimeSeconds?: number }) => void) | undefined;
    const run = vi.fn(
      async (
        _args: string[],
        options: {
          onProgress?: (progress: { outTimeSeconds?: number }) => void;
        },
      ) => {
        report = options.onProgress;
        return { stdout: '', stderr: output };
      },
    );
    const onProgress = vi.fn();
    await detectBlackIntervals(
      '/media/tv/episode.mkv',
      { startTimeSeconds: 0, onProgress },
      { runFfmpeg: run },
    );

    const args = run.mock.calls[0]?.[0] as string[];
    expect(args).toEqual(expect.arrayContaining(['-progress', 'pipe:1']));
    report?.({ outTimeSeconds: 1800 });
    // A block without an out time is ignored rather than reported as zero.
    report?.({});
    expect(onProgress.mock.calls).toEqual([[1800]]);
  });
});
