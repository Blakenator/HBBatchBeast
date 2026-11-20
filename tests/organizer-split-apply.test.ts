import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appPaths } from '../src/backend/helpers/appPaths';
import {
  executeSplitTask,
  type SplitTask,
} from '../src/backend/organizer/split/apply';
import {
  buildExactSplitArgs,
  buildSegmentCopyArgs,
  buildSubtitleCutArgs,
  FfmpegCancelledError,
  parseFfmpegProgressLine,
  runFfmpeg,
} from '../src/backend/organizer/split/execute';
import { parseKeyframeTimes } from '../src/backend/organizer/split/probe';
import type {
  OrganizeSplitPlan,
  SplitSegment,
} from '../src/common/organizer/split';
import type {
  OrganizePlanItem,
  TvdbEpisode,
} from '../src/common/organizer/types';

const episode = (episodeNumber: number): TvdbEpisode => ({
  tag: `S01E0${episodeNumber}`,
  name: `Episode ${episodeNumber}`,
  seasonNumber: 1,
  episodeNumber,
});

let root: string;
let source: string;
let paths: ReturnType<typeof appPaths>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-split-'));
  source = path.join(root, 'library', 'Show', 'S01E01-E02.mkv');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, '0123456789');
  paths = appPaths({
    userDataPath: path.join(root, 'userData'),
    logsPath: path.join(root, 'logs'),
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function item(): OrganizePlanItem {
  return {
    id: source,
    mediaType: 'tv',
    sourcePath: source,
    sourceRoot: path.join(root, 'library'),
    sourceRelativePath: 'Show/S01E01-E02.mkv',
    targetPath: source,
    relativeTarget: 'Show/S01E01-E02.mkv',
    action: 'skip',
    sidecars: [],
    episode: episode(1),
    episodes: [episode(1), episode(2)],
  } as OrganizePlanItem;
}

function segments(): SplitSegment[] {
  return [
    {
      index: 0,
      startSeconds: 0,
      endSeconds: 60,
      episode: episode(1),
      targetPath: path.join(root, 'out', 'S01E01.mkv'),
    },
    {
      index: 1,
      startSeconds: 60,
      endSeconds: 120,
      episode: episode(2),
      targetPath: path.join(root, 'out', 'S01E02.mkv'),
    },
  ];
}

function split(overrides: Partial<OrganizeSplitPlan> = {}): OrganizeSplitPlan {
  return {
    itemId: source,
    sourcePath: source,
    fileSize: 10,
    fileDurationSeconds: 120,
    cutMode: 'exact',
    originalPolicy: 'backup',
    sidecarPolicy: 'leave',
    estimate: { method: 'tvdb' },
    segments: segments(),
    updatedAt: 1,
    ...overrides,
  };
}

function task(overrides: Partial<OrganizeSplitPlan> = {}): SplitTask {
  return { item: item(), plan: split(overrides), segments: segments() };
}

const fakeRun = async (args: readonly string[]) => {
  const output = args[args.length - 1];
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, 'segment');
  return { stdout: '', stderr: '' };
};

/** Records every ffmpeg call and emulates the segment muxer's output files. */
function fakeSegmentRun(calls: string[][]) {
  return vi.fn(async (args: readonly string[]) => {
    calls.push([...args]);
    if (args.includes('-f') && args[args.indexOf('-f') + 1] === 'segment') {
      const pattern = args[args.length - 1];
      const times =
        args[args.indexOf('-segment_times') + 1]?.split(',').filter(Boolean) ??
        [];
      for (let index = 0; index <= times.length; index += 1) {
        const file = pattern.replace('%04d', String(index).padStart(4, '0'));
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'segment');
      }
      return { stdout: '', stderr: '' };
    }
    return fakeRun(args);
  });
}

function segmentTimes(calls: string[][]): string | undefined {
  const call = calls.find((args) => args.includes('-segment_times'));
  return call?.[call.indexOf('-segment_times') + 1];
}

describe('ffmpeg argument builders', () => {
  it('re-encodes video for exact cuts and copies audio and subtitles', () => {
    const args = buildExactSplitArgs({
      sourcePath: '/src/a.mkv',
      outputPath: '/out/a.mkv',
      startSeconds: 10.5,
      endSeconds: 70.25,
    });
    // Output seeking keeps copied audio aligned with the re-encoded video.
    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('10.500');
    expect(args[args.indexOf('-t') + 1]).toBe('59.750');
    expect(args.filter((arg) => arg === '-map')).toHaveLength(3);
    expect(args[args.indexOf('-map') + 1]).toBe('0:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-crf') + 1]).toBe('18');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:s') + 1]).toBe('copy');
    expect(args[args.length - 1]).toBe('/out/a.mkv');
  });

  it('writes every lossless segment in one muxer pass', () => {
    const args = buildSegmentCopyArgs({
      sourcePath: '/src/a.mkv',
      outputPattern: '/out/segment%04d.mkv',
      segmentTimes: [1210.5, 2420],
    });
    expect(args[args.indexOf('-i') + 1]).toBe('/src/a.mkv');
    expect(args.filter((arg) => arg === '-map')).toHaveLength(3);
    expect(args[args.indexOf('-map') + 1]).toBe('0:v');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args[args.indexOf('-f') + 1]).toBe('segment');
    expect(args[args.indexOf('-segment_times') + 1]).toBe('1210.500,2420.000');
    expect(args[args.indexOf('-reset_timestamps') + 1]).toBe('1');
    expect(args[args.length - 1]).toBe('/out/segment%04d.mkv');
  });

  it('retimes text subtitles for a segment', () => {
    const args = buildSubtitleCutArgs({
      sourcePath: '/src/a.en.srt',
      outputPath: '/out/a.en.srt',
      startSeconds: 60,
      endSeconds: 120,
      format: 'srt',
    });
    expect(args[args.indexOf('-c:s') + 1]).toBe('srt');
    expect(args[args.indexOf('-f') + 1]).toBe('srt');
    // Output seeking keeps cues in range; the offset retimes them to zero.
    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('60.000');
    expect(args[args.indexOf('-t') + 1]).toBe('60.000');
    expect(args[args.indexOf('-output_ts_offset') + 1]).toBe('-60.000');
  });
});

describe('ffmpeg progress parsing', () => {
  it('reads out_time_ms as microseconds and flags the end', () => {
    expect(parseFfmpegProgressLine('out_time_ms=1500000')).toEqual({
      outTimeSeconds: 1.5,
    });
    expect(parseFfmpegProgressLine('out_time=00:01:02.50')).toEqual({
      outTimeSeconds: 62.5,
    });
    expect(parseFfmpegProgressLine('progress=end')).toEqual({
      finished: true,
    });
    expect(parseFfmpegProgressLine('speed=1.5x')).toEqual({ speed: '1.5x' });
    expect(parseFfmpegProgressLine('frame=10')).toBeUndefined();
  });

  it('parses keyframe timestamps and ignores non-keyframes', () => {
    expect(
      parseKeyframeTimes(
        JSON.stringify({
          frames: [
            { key_frame: 1, best_effort_timestamp_time: '0.000000' },
            { key_frame: 0, best_effort_timestamp_time: '10.500000' },
            { key_frame: 1, best_effort_timestamp_time: '20.000000' },
          ],
        }),
      ),
    ).toEqual([0, 20]);
    expect(
      parseKeyframeTimes(
        JSON.stringify({
          frames: [{ key_frame: 1, pts_time: '7.000000' }],
        }),
      ),
    ).toEqual([7]);
    expect(parseKeyframeTimes('not json')).toEqual([]);
  });
});

describe('executeSplitTask', () => {
  it('writes every segment, then backs up the original', async () => {
    const result = await executeSplitTask(task(), paths, {
      runFfmpeg: fakeRun,
    });
    expect(fs.readFileSync(path.join(root, 'out', 'S01E01.mkv'), 'utf8')).toBe(
      'segment',
    );
    expect(fs.readFileSync(path.join(root, 'out', 'S01E02.mkv'), 'utf8')).toBe(
      'segment',
    );
    expect(result.outputs).toHaveLength(2);
    expect(result.originalKept).toBe(false);
    expect(fs.existsSync(source)).toBe(false);
    expect(result.backupPath).toBeTruthy();
    expect(fs.readFileSync(result.backupPath as string, 'utf8')).toBe(
      '0123456789',
    );
    // The backup keeps the path relative to the source root.
    expect(result.backupPath?.replace(/\\/g, '/')).toContain(
      'Show/S01E01-E02.mkv',
    );
  });

  it('deletes the original only after every segment succeeded', async () => {
    const result = await executeSplitTask(
      task({ originalPolicy: 'delete' }),
      paths,
      { runFfmpeg: fakeRun },
    );
    expect(result.originalKept).toBe(false);
    expect(fs.existsSync(source)).toBe(false);
  });

  it('leaves the original in place for the keep policy', async () => {
    const result = await executeSplitTask(
      task({ originalPolicy: 'keep' }),
      paths,
      { runFfmpeg: fakeRun },
    );
    expect(result.originalKept).toBe(true);
    expect(fs.existsSync(source)).toBe(true);
  });

  it('removes completed segments when a later segment fails', async () => {
    let calls = 0;
    const failingRun = async (args: readonly string[]) => {
      calls += 1;
      const output = args[args.length - 1];
      if (calls === 2) throw new Error('disk full');
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'segment');
      return { stdout: '', stderr: '' };
    };
    await expect(
      executeSplitTask(task(), paths, { runFfmpeg: failingRun }),
    ).rejects.toThrow(/disk full/);
    expect(fs.existsSync(path.join(root, 'out', 'S01E01.mkv'))).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  it('stops before the first cut when the apply is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(fakeRun);
    await expect(
      executeSplitTask(task(), paths, {
        runFfmpeg: run,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(FfmpegCancelledError);
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(source)).toBe(true);
  });
  it('cuts subtitles at the keyframe-snapped segment starts', async () => {
    const sidecarPath = path.join(root, 'library', 'Show', 'S01E01-E02.en.srt');
    fs.writeFileSync(sidecarPath, '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    const calls: string[][] = [];
    const run = fakeSegmentRun(calls);
    const result = await executeSplitTask(
      {
        item: {
          ...item(),
          sidecars: [{ sourcePath: sidecarPath, targetPath: sidecarPath }],
        },
        plan: split({
          cutMode: 'copy',
          sidecarPolicy: 'split',
          segments: segments().map((segment) => ({ ...segment })),
        }),
        segments: segments(),
      },
      paths,
      {
        runFfmpeg: run,
        // The planner asked for a cut at 60 s; the nearest keyframe is 62 s.
        findKeyframes: async () => [
          { requestedSeconds: 60, keyframeSeconds: 62 },
        ],
        probeStartTime: async () => 0,
      },
    );

    expect(result.outputs).toHaveLength(2);
    expect(segmentTimes(calls)).toBe('62.000');
    const segmentCall = calls.find((args) => args.includes('-segment_times'));
    expect(segmentCall?.[segmentCall.indexOf('-c') + 1]).toBe('copy');
    const subtitleCalls = calls.filter((args) =>
      args[args.length - 1].includes('.srt'),
    );
    expect(subtitleCalls).toHaveLength(2);
    // The first episode ends where the snapped second episode begins.
    expect(subtitleCalls[0][subtitleCalls[0].indexOf('-t') + 1]).toBe('62.000');
    // The second episode starts at the snapped keyframe, not the marker.
    expect(subtitleCalls[1][subtitleCalls[1].indexOf('-ss') + 1]).toBe(
      '62.000',
    );
    expect(subtitleCalls[1][subtitleCalls[1].indexOf('-t') + 1]).toBe('58.000');
    expect(
      subtitleCalls[1][subtitleCalls[1].indexOf('-output_ts_offset') + 1],
    ).toBe('-62.000');
  });

  it('uses the keyframe the editor picked instead of re-probing', async () => {
    const calls: string[][] = [];
    const findKeyframes = vi.fn(async () => [
      { requestedSeconds: 60, keyframeSeconds: 51 },
    ]);
    const probeStartTime = vi.fn(async () => 5.4);
    const copySegments = segments().map((segment, index) =>
      index === 0 ? segment : { ...segment, cutSeconds: 58.2 },
    );

    await executeSplitTask(
      {
        item: item(),
        plan: split({ cutMode: 'copy', segments: copySegments }),
        segments: copySegments,
      },
      paths,
      {
        runFfmpeg: fakeSegmentRun(calls),
        findKeyframes,
        probeStartTime,
      },
    );

    // The UI's chosen keyframe is authoritative, and no probe is needed.
    expect(segmentTimes(calls)).toBe('58.200');
    expect(findKeyframes).not.toHaveBeenCalled();
    expect(probeStartTime).not.toHaveBeenCalled();
  });

  it('normalizes unsnapped copy cuts by the container start offset', async () => {
    const calls: string[][] = [];
    const findKeyframes = vi.fn(async () => [
      { requestedSeconds: 60, keyframeSeconds: 58.4 },
    ]);
    const probeStartTime = vi.fn(async () => 5.4);

    await executeSplitTask(
      {
        item: item(),
        plan: split({
          cutMode: 'copy',
          segments: segments().map((segment) => ({ ...segment })),
        }),
        segments: segments(),
      },
      paths,
      {
        runFfmpeg: fakeSegmentRun(calls),
        findKeyframes,
        probeStartTime,
      },
    );

    // The probe reads on the container timeline; the muxer cuts on the file's.
    expect(findKeyframes).toHaveBeenCalledWith(
      source,
      [60],
      expect.objectContaining({ startTimeSeconds: 5.4 }),
    );
    expect(segmentTimes(calls)).toBe('58.400');
  });

  it('applies the original-file policy when segments are skipped', async () => {
    const result = await executeSplitTask(
      task({ skippedSegments: [1], originalPolicy: 'delete' }),
      paths,
      { runFfmpeg: fakeRun },
    );
    expect(result.outputs.map((output) => output.targetPath)).toEqual([
      path.join(root, 'out', 'S01E01.mkv'),
    ]);
    expect(fs.existsSync(path.join(root, 'out', 'S01E01.mkv'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'out', 'S01E02.mkv'))).toBe(false);
    expect(fs.existsSync(source)).toBe(false);
    expect(result.originalKept).toBe(false);
  });

  it('backs up the original when it is skipped and the policy asks for it', async () => {
    const result = await executeSplitTask(
      task({ skippedSegments: [1], originalPolicy: 'backup' }),
      paths,
      { runFfmpeg: fakeRun },
    );
    expect(fs.existsSync(source)).toBe(false);
    expect(result.backupPath).toBeTruthy();
    expect(fs.readFileSync(result.backupPath as string, 'utf8')).toBe(
      '0123456789',
    );
  });

  it('keeps a cut skipped in copy mode from shifting the remaining segments', async () => {
    const calls: string[][] = [];
    const copySegments = segments().map((segment) => ({ ...segment }));
    const result = await executeSplitTask(
      {
        item: item(),
        plan: split({
          cutMode: 'copy',
          segments: copySegments,
          skippedSegments: [1],
          originalPolicy: 'backup',
        }),
        segments: copySegments,
      },
      paths,
      { runFfmpeg: fakeSegmentRun(calls) },
    );

    // Both pieces are cut so episode one still ends at the real boundary, but
    // the skipped piece is discarded instead of being written to its target.
    expect(segmentTimes(calls)).toBe('60.000');
    expect(result.outputs).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'out', 'S01E01.mkv'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'out', 'S01E02.mkv'))).toBe(false);
    // The backup policy still moves the source once the remaining cut is done.
    expect(fs.existsSync(source)).toBe(false);
    expect(result.backupPath).toBeTruthy();
  });

  it('replaces an existing target and keeps the old file for undo', async () => {
    const existing = path.join(root, 'out', 'S01E01.mkv');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'old segment');

    const result = await executeSplitTask(task({ overwrite: true }), paths, {
      runFfmpeg: fakeRun,
    });

    expect(fs.readFileSync(existing, 'utf8')).toBe('segment');
    const replaced = result.outputs[0].replacedBackupPath;
    expect(replaced).toBeTruthy();
    expect(fs.readFileSync(replaced as string, 'utf8')).toBe('old segment');
    expect(result.warnings.join('\n')).toMatch(/existing file.*replaced/i);
  });

  it('restores an overwritten target when a later segment fails', async () => {
    const existing = path.join(root, 'out', 'S01E01.mkv');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'old segment');
    let calls = 0;
    const failingRun = async (args: readonly string[]) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return fakeRun(args);
    };

    await expect(
      executeSplitTask(task({ overwrite: true }), paths, {
        runFfmpeg: failingRun,
      }),
    ).rejects.toThrow(/disk full/);

    expect(fs.readFileSync(existing, 'utf8')).toBe('old segment');
    expect(fs.existsSync(path.join(root, 'out', 'S01E02.mkv'))).toBe(false);
  });

  it('still refuses an existing target without the overwrite flag', async () => {
    const existing = path.join(root, 'out', 'S01E01.mkv');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'old segment');

    await expect(
      executeSplitTask(task(), paths, { runFfmpeg: fakeRun }),
    ).rejects.toThrow(/Target already exists/);
    expect(fs.readFileSync(existing, 'utf8')).toBe('old segment');
  });

  it('backs up a subtitle replaced with its overwritten target', async () => {
    const sidecarPath = path.join(root, 'library', 'Show', 'S01E01-E02.en.srt');
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, 'source subtitle');
    const media = path.join(root, 'out', 'S01E01.mkv');
    fs.mkdirSync(path.dirname(media), { recursive: true });
    fs.writeFileSync(media, 'old segment');
    const sidecarTargetPath = path.join(root, 'out', 'S01E01.en.srt');
    fs.writeFileSync(sidecarTargetPath, 'old subtitle');

    const result = await executeSplitTask(
      {
        item: {
          ...item(),
          sidecars: [{ sourcePath: sidecarPath, targetPath: sidecarPath }],
        },
        plan: split({ overwrite: true, sidecarPolicy: 'copy' }),
        segments: segments(),
      },
      paths,
      { runFfmpeg: fakeRun },
    );

    expect(fs.readFileSync(sidecarTargetPath, 'utf8')).toBe('source subtitle');
    const backup = result.sidecarBackups?.find(
      (entry) => entry.sourcePath === sidecarTargetPath,
    );
    expect(backup).toBeTruthy();
    expect(fs.readFileSync(backup?.backupPath as string, 'utf8')).toBe(
      'old subtitle',
    );
  });
});

describe('runFfmpeg', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runFfmpeg(['-version'], { signal: controller.signal }),
    ).rejects.toBeInstanceOf(FfmpegCancelledError);
  });
});
