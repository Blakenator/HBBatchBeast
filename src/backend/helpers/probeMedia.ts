import fs from 'fs';
import { AppError } from '@superflag/super-ipc-core';
import { MediaInfo, MediaStreamInfo } from '../../common';
import { RawProbe, runFfprobe } from './ffprobe';

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
export async function probeMedia(filePath: string): Promise<MediaInfo> {
  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found', { context: { filePath } });
  }

  try {
    return parseProbe(filePath, await runFfprobe(filePath));
  } catch (error) {
    throw new AppError('ffprobe failed', {
      inner: error,
      context: {
        filePath,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
