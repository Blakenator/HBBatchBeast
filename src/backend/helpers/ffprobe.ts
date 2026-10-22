import { execFile } from 'child_process';
import ffprobeStatic from 'ffprobe-static';

/** Raw stream/format fields returned by `ffprobe -print_format json`. */
export interface RawProbeStream {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  bit_rate?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  profile?: string;
  nb_frames?: string;
  duration?: string;
  tags?: { language?: string; title?: string };
  [key: string]: unknown;
}

export interface RawProbeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  [key: string]: unknown;
}

export interface RawProbe {
  streams?: RawProbeStream[];
  format?: RawProbeFormat;
}

/** Inside an asar the binary has to be read from the unpacked copy. */
export function ffprobeExecutablePath(): string {
  return ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
}

const MAX_PROBE_BYTES = 8 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 30_000;

/** Runs ffprobe and resolves its parsed JSON. */
export function runFfprobe(filePath: string): Promise<RawProbe> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobeExecutablePath(),
      [
        '-hide_banner',
        '-show_format',
        '-show_streams',
        '-print_format',
        'json',
        filePath,
      ],
      {
        maxBuffer: MAX_PROBE_BYTES,
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `ffprobe failed for "${filePath}": ${error.message}${
                stderr ? `\n${stderr}` : ''
              }`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as RawProbe);
        } catch (parseError) {
          reject(
            new Error(
              `Could not parse ffprobe output for "${filePath}": ${
                parseError instanceof Error ? parseError.message : String(parseError)
              }`,
            ),
          );
        }
      },
    );
  });
}
