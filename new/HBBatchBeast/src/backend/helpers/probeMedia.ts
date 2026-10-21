import { execFile } from 'child_process';
import fs from 'fs';
import ffprobeStatic from 'ffprobe-static';
import { AppError } from '@superflag/super-ipc-core';
import { MediaInfo, MediaStreamInfo } from '../../common';

/** Inside an asar the binary has to be read from the unpacked copy. */
function ffprobePath(): string {
  return ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
}

interface RawProbe {
  streams?: {
    index?: number;
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    channels?: number;
    channel_layout?: string;
    sample_rate?: string;
    bit_rate?: string;
    avg_frame_rate?: string;
    duration?: string;
    tags?: { language?: string; title?: string };
  }[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

export function parseProbe(filePath: string, raw: RawProbe): MediaInfo {
  const streams: MediaStreamInfo[] = (raw.streams ?? []).map((stream, index) => ({
    index: stream.index ?? index,
    type: stream.codec_type ?? 'unknown',
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    channels: stream.channels,
    channelLayout: stream.channel_layout,
    sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined,
    bitRate: stream.bit_rate ? Number(stream.bit_rate) : undefined,
    frameRate: stream.avg_frame_rate,
    duration: stream.duration ? Number(stream.duration) : undefined,
    language: stream.tags?.language,
    title: stream.tags?.title,
  }));

  return {
    path: filePath,
    container: raw.format?.format_name,
    duration: raw.format?.duration ? Number(raw.format.duration) : undefined,
    size: raw.format?.size ? Number(raw.format.size) : undefined,
    bitRate: raw.format?.bit_rate ? Number(raw.format.bit_rate) : undefined,
    streams,
  };
}

/** Reads stream metadata for one media file through the bundled ffprobe. */
export function probeMedia(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new AppError('File not found', { context: { filePath } }));
      return;
    }

    execFile(
      ffprobePath(),
      [
        '-hide_banner',
        '-show_format',
        '-show_streams',
        '-print_format',
        'json',
        filePath,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new AppError('ffprobe failed', {
              context: { filePath, message: error.message },
            }),
          );
          return;
        }
        try {
          resolve(parseProbe(filePath, JSON.parse(stdout) as RawProbe));
        } catch (parseError) {
          reject(
            new AppError('Could not parse ffprobe output', {
              inner: parseError,
              context: { filePath },
            }),
          );
        }
      },
    );
  });
}
