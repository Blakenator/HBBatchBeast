import { spawn } from 'child_process';
import { resolveFfmpegExecutable } from '../../helpers/ffmpeg';

export interface FfmpegProgress {
  outTimeSeconds?: number;
  speed?: string;
  finished?: boolean;
}

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
}

export interface FfmpegRunOptions {
  executable?: string;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegProgress) => void;
  timeoutMs?: number;
}

export class FfmpegCancelledError extends Error {
  constructor() {
    super('ffmpeg was cancelled.');
    this.name = 'FfmpegCancelledError';
  }
}

function parseTimecode(value: string): number | undefined {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Parses one `-progress pipe:1` block into a friendlier snapshot. */
export function parseFfmpegProgressLine(line: string): FfmpegProgress | undefined {
  const [rawKey, ...rest] = line.trim().split('=');
  const value = rest.join('=');
  if (!rawKey) return undefined;
  switch (rawKey) {
    case 'out_time_us': {
      const micros = Number(value);
      return Number.isFinite(micros)
        ? { outTimeSeconds: micros / 1_000_000 }
        : undefined;
    }
    case 'out_time_ms': {
      const micros = Number(value);
      // Despite the name, ffmpeg prints microseconds here.
      return Number.isFinite(micros)
        ? { outTimeSeconds: micros / 1_000_000 }
        : undefined;
    }
    case 'out_time': {
      const seconds = parseTimecode(value);
      return seconds !== undefined ? { outTimeSeconds: seconds } : undefined;
    }
    case 'speed':
      return value && value !== 'N/A' ? { speed: value.trim() } : undefined;
    case 'progress':
      return value.trim() === 'end' ? { finished: true } : undefined;
    default:
      return undefined;
  }
}

function terminate(child: ReturnType<typeof spawn>): void {
  if (child.killed || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => {});
    return;
  }
  const killGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };
  killGroup('SIGTERM');
  const timer = setTimeout(() => killGroup('SIGKILL'), 3000);
  timer.unref?.();
}

/**
 * Spawns ffmpeg with an argv array (no shell) and supports cancellation with
 * the same escalation as the conversion runner.
 */
export function runFfmpeg(
  args: readonly string[],
  options: FfmpegRunOptions = {},
): Promise<FfmpegRunResult> {
  const executable = options.executable ?? resolveFfmpegExecutable();
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new FfmpegCancelledError());
      return;
    }
    const child = spawn(executable, [...args], {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let progressBuffer = '';
    let cancelled = false;

    const onAbort = () => {
      cancelled = true;
      terminate(child);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            cancelled = true;
            terminate(child);
          }, options.timeoutMs)
        : undefined;
    timeout?.unref?.();

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (!options.onProgress) return;
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const progress = parseFfmpegProgressLine(line);
        if (progress) options.onProgress(progress);
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      // Keep the tail only; some encoders are very chatty.
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
    });
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (timeout) clearTimeout(timeout);
      if (cancelled) {
        reject(new FfmpegCancelledError());
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `ffmpeg exited with ${code ?? signal ?? 'an unknown status'}${
            stderr.trim() ? `: ${stderr.trim()}` : ''
          }`,
        ),
      );
    });
  });
}

export interface ExactSplitArgsInput {
  sourcePath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Frame-exact segment. Seeking on the output side avoids the keyframe-preroll
 * that input seeking with copied audio adds on Matroska input; the video is
 * re-encoded so the first frame lands on the requested timestamp.
 */
export function buildExactSplitArgs(input: ExactSplitArgsInput): string[] {
  const duration = Math.max(0, input.endSeconds - input.startSeconds);
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    input.sourcePath,
    '-ss',
    input.startSeconds.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-map',
    '0:s?',
    '-avoid_negative_ts',
    'make_zero',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    '-c:s',
    'copy',
    '-progress',
    'pipe:1',
    '-y',
    input.outputPath,
  ];
}

export interface SegmentCopyArgsInput {
  sourcePath: string;
  outputPattern: string;
  /** Interior cut times in seconds; the muxer cuts at the next keyframe. */
  segmentTimes: number[];
}

/**
 * One lossless pass that writes every segment. Cutting each segment with its
 * own `-ss` and `-c copy` can start up to a GOP early on Matroska input, which
 * duplicates the previous episode's tail; the segment muxer splits on
 * keyframes without overlap and resets each file's timestamps.
 */
export function buildSegmentCopyArgs(input: SegmentCopyArgsInput): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    input.sourcePath,
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-map',
    '0:s?',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-f',
    'segment',
    '-segment_times',
    input.segmentTimes.map((seconds) => seconds.toFixed(3)).join(','),
    '-reset_timestamps',
    '1',
    '-progress',
    'pipe:1',
    '-y',
    input.outputPattern,
  ];
}

/** Cuts one text subtitle sidecar and retimes it to the segment. */
export function buildSubtitleCutArgs(input: {
  sourcePath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
  format: string;
}): string[] {
  const duration = Math.max(0, input.endSeconds - input.startSeconds);
  // Subtitle demuxers do not seek by timestamp reliably, so seek on the output
  // side and shift the surviving cues back to zero.
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    input.sourcePath,
    '-ss',
    input.startSeconds.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-c:s',
    input.format,
    // The temp output ends in `.hbb-split.tmp`, so name the muxer explicitly.
    '-f',
    input.format,
    '-output_ts_offset',
    (-input.startSeconds).toFixed(3),
    '-y',
    input.outputPath,
  ];
}
