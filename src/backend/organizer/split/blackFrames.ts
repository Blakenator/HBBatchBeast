import type { SplitBlackInterval } from '../../../common/organizer/split';
import { runFfmpeg } from './execute';

export interface BlackDetectOptions {
  executable?: string;
  /** Video timeline offset reported by ffprobe; results are normalized by it. */
  startTimeSeconds?: number;
  /** Shortest black run to report. Defaults to 0.3 s. */
  minDurationSeconds?: number;
  /** Fraction of maximum luma considered black. Defaults to 0.1. */
  pixelThreshold?: number;
  signal?: AbortSignal;
  /** Called with ffmpeg's decoded output time as the scan advances. */
  onProgress?: (seconds: number) => void;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Reads the `[blackdetect] black_start:… black_end:…` lines ffmpeg writes to
 * stderr. The filter reports container timestamps, so callers pass the video
 * start offset to normalize them to the file-relative timeline used by the
 * editor and the segment muxer.
 */
export function parseBlackDetectOutput(
  output: string,
  startTimeSeconds = 0,
): SplitBlackInterval[] {
  const pattern =
    /black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)\s+black_duration:\s*([0-9.]+)/g;
  const intervals = new Map<string, SplitBlackInterval>();
  for (const match of output.matchAll(pattern)) {
    const start = Number(match[1]) - startTimeSeconds;
    const end = Number(match[2]) - startTimeSeconds;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const interval = {
      startSeconds: roundSeconds(Math.max(0, start)),
      endSeconds: roundSeconds(Math.max(0, end)),
    };
    intervals.set(`${interval.startSeconds}:${interval.endSeconds}`, interval);
  }
  return [...intervals.values()].sort(
    (left, right) => left.startSeconds - right.startSeconds,
  );
}

/**
 * Scans a file for black runs with ffmpeg's `blackdetect` filter. Decoding the
 * whole file is the price of finding dividers without sampling misses; the
 * editor keeps the result so both black-frame tools share one scan.
 */
export async function detectBlackIntervals(
  filePath: string,
  options: BlackDetectOptions = {},
  deps: { runFfmpeg?: typeof runFfmpeg } = {},
): Promise<SplitBlackInterval[]> {
  const run = deps.runFfmpeg ?? runFfmpeg;
  const minDuration = Math.max(0, options.minDurationSeconds ?? 0.3);
  const pixelThreshold = Math.min(
    1,
    Math.max(0, options.pixelThreshold ?? 0.1),
  );
  const args = [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'info',
    '-i',
    filePath,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    `blackdetect=d=${minDuration}:pix_th=${pixelThreshold}`,
    ...(options.onProgress ? ['-progress', 'pipe:1'] : []),
    '-f',
    'null',
    '-',
  ];
  const result = await run(args, {
    ...(options.executable ? { executable: options.executable } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress
      ? {
          onProgress: (progress: { outTimeSeconds?: number }) => {
            if (progress.outTimeSeconds !== undefined) {
              options.onProgress?.(progress.outTimeSeconds);
            }
          },
        }
      : {}),
  });
  return parseBlackDetectOutput(result.stderr, options.startTimeSeconds ?? 0);
}
