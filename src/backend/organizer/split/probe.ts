import fs from 'fs';
import type {
  OrganizeSplitProbe,
  SplitKeyframeCut,
  SplitProbeStream,
  SplitProbeStreamType,
} from '../../../common/organizer/split';
import type { RawProbe, RawProbeStream } from '../../helpers/ffprobe';
import { runFfprobe, runFfprobeArgs } from '../../helpers/ffprobe';

export type SplitStreamSummary = SplitProbeStream;
export type SplitSourceProbe = OrganizeSplitProbe;
export type KeyframeCut = SplitKeyframeCut;

function streamType(value: string | undefined): SplitProbeStreamType {
  switch (value) {
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'subtitle':
      return 'subtitle';
    case 'attachment':
      return 'attachment';
    default:
      return 'other';
  }
}

function summarizeStream(
  stream: RawProbeStream,
  index: number,
): SplitStreamSummary {
  const type = streamType(stream.codec_type);
  return {
    index,
    type,
    ...(stream.codec_name ? { codec: stream.codec_name } : {}),
    ...(stream.width ? { width: stream.width } : {}),
    ...(stream.height ? { height: stream.height } : {}),
    ...(stream.channels ? { channels: stream.channels } : {}),
    ...(stream.tags?.language ? { language: stream.tags.language } : {}),
    ...(stream.tags?.title ? { title: stream.tags.title } : {}),
  };
}

function videoStartTime(raw: RawProbe): number {
  const video = (raw.streams ?? []).find(
    (stream) => stream.codec_type === 'video',
  );
  const streamStart = Number(
    (video as { start_time?: string } | undefined)?.start_time,
  );
  if (Number.isFinite(streamStart)) return streamStart;
  const formatStart = Number(raw.format?.start_time);
  return Number.isFinite(formatStart) ? formatStart : 0;
}

/** One ffprobe call with everything the split editor needs to plan a file. */
export async function probeSplitSource(
  filePath: string,
): Promise<SplitSourceProbe> {
  const raw = await runFfprobe(filePath);
  const streams = (raw.streams ?? []).map(summarizeStream);
  const stat = fs.statSync(filePath);
  const durationSeconds = Number(raw.format?.duration);
  const video = streams.find((stream) => stream.type === 'video');
  return {
    path: filePath,
    size: stat.size,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    startTimeSeconds: videoStartTime(raw),
    ...(raw.format?.format_name ? { formatName: raw.format.format_name } : {}),
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
    videoCodecs: streams
      .filter((stream) => stream.type === 'video' && stream.codec)
      .map((stream) => stream.codec as string),
    audioCodecs: streams
      .filter((stream) => stream.type === 'audio' && stream.codec)
      .map((stream) => stream.codec as string),
    subtitleCodecs: streams
      .filter((stream) => stream.type === 'subtitle' && stream.codec)
      .map((stream) => stream.codec as string),
    streams,
  };
}

/**
 * Reads the timeline offset of the first video frame. ffprobe reports keyframe
 * PTS on the container timeline, but ffmpeg's segment muxer starts its output
 * clock at the first video frame. The format start can be earlier (audio
 * encoder delay), which would move every cut one GOP later, so the video
 * stream wins and the format is only a fallback.
 */
export async function readMediaStartTime(filePath: string): Promise<number> {
  try {
    const output = await runFfprobeArgs([
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=start_time:format=start_time',
      '-print_format',
      'json',
      filePath,
    ]);
    const parsed = JSON.parse(output) as {
      streams?: { start_time?: string }[];
      format?: { start_time?: string };
    };
    const video = Number(parsed.streams?.[0]?.start_time);
    if (Number.isFinite(video)) return video;
    const format = Number(parsed.format?.start_time);
    return Number.isFinite(format) ? format : 0;
  } catch {
    return 0;
  }
}

interface KeyframeOptions {
  /** Half-width of the probe window in seconds. */
  windowSeconds?: number;
  /** Minimum keyframe spacing enforced between adjacent cuts. */
  minGapSeconds?: number;
  /**
   * PTS offset of the file start. Callers pass file-relative times; the window
   * is shifted to the container timeline and results are shifted back.
   */
  startTimeSeconds?: number;
}

interface RawFrame {
  key_frame?: number;
  best_effort_timestamp_time?: string;
  pts_time?: string;
  pkt_pts_time?: string;
}

export interface KeyframeDeps {
  /** Test hook; reads the keyframes inside one window. */
  readWindow?: (
    filePath: string,
    seconds: number,
    windowSeconds: number,
  ) => Promise<number[]>;
}

/**
 * Parses the JSON from `-show_entries frame=best_effort_timestamp_time,key_frame`.
 * Some ffprobe builds do not emit `pts_time` for frames at all, so the
 * best-effort timestamp is the portable field.
 */
export function parseKeyframeTimes(output: string): number[] {
  let frames: RawFrame[];
  try {
    frames = (JSON.parse(output) as { frames?: RawFrame[] }).frames ?? [];
  } catch {
    return [];
  }
  return frames
    .filter((frame) => frame.key_frame !== 0)
    .map((frame) =>
      Number(
        frame.best_effort_timestamp_time ??
          frame.pts_time ??
          frame.pkt_pts_time,
      ),
    )
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
}

async function keyframesAround(
  filePath: string,
  seconds: number,
  windowSeconds: number,
): Promise<number[]> {
  const start = Math.max(0, seconds - windowSeconds);
  const end = seconds + windowSeconds;
  try {
    const output = await runFfprobeArgs([
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-skip_frame',
      'nokey',
      '-read_intervals',
      `${start}%${end}`,
      '-show_entries',
      'frame=best_effort_timestamp_time,key_frame',
      '-print_format',
      'json',
      filePath,
    ]);
    return parseKeyframeTimes(output);
  } catch {
    return [];
  }
}

function nearest(values: number[], target: number): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Finds a keyframe near every requested cut. Only short windows are read, so a
 * multi-gigabyte episode does not have to be scanned end to end.
 */
export async function findKeyframesNear(
  filePath: string,
  times: readonly number[],
  options: KeyframeOptions = {},
  deps: KeyframeDeps = {},
): Promise<KeyframeCut[]> {
  const windowSeconds = options.windowSeconds ?? 10;
  const startTimeSeconds = options.startTimeSeconds ?? 0;
  const readWindow = deps.readWindow ?? keyframesAround;
  const results: KeyframeCut[] = [];
  let previous = -Infinity;
  for (const requested of times) {
    const candidates = (
      await readWindow(filePath, requested + startTimeSeconds, windowSeconds)
    )
      .map((seconds) => seconds - startTimeSeconds)
      .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
    const found = nearest(candidates, requested);
    let keyframeSeconds = found;
    if (
      keyframeSeconds !== undefined &&
      options.minGapSeconds !== undefined &&
      keyframeSeconds < previous + options.minGapSeconds
    ) {
      keyframeSeconds =
        candidates.find(
          (candidate) => candidate >= previous + (options.minGapSeconds ?? 0),
        ) ?? found;
    }
    if (keyframeSeconds !== undefined) previous = keyframeSeconds;
    const sortedCandidates = [...new Set(candidates)].sort(
      (left, right) => left - right,
    );
    results.push({
      requestedSeconds: requested,
      ...(keyframeSeconds !== undefined
        ? {
            keyframeSeconds,
            deltaSeconds: keyframeSeconds - requested,
          }
        : {}),
      ...(sortedCandidates.length > 0 ? { candidates: sortedCandidates } : {}),
    });
  }
  return results;
}
