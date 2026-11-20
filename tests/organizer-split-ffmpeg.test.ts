import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { appPaths } from '../src/backend/helpers/appPaths';
import { executeSplitTask } from '../src/backend/organizer/split/apply';
import { detectBlackIntervals } from '../src/backend/organizer/split/blackFrames';
import {
  findKeyframesNear,
  probeSplitSource,
} from '../src/backend/organizer/split/probe';
import type {
  OrganizeSplitPlan,
  SplitSegment,
} from '../src/common/organizer/split';
import type {
  OrganizePlanItem,
  TvdbEpisode,
} from '../src/common/organizer/types';

const ffmpegBinary = ffmpegStatic as string | null;
const ffprobeBinary = (ffprobeStatic as { path: string }).path;
const canRun =
  Boolean(ffmpegBinary && fs.existsSync(ffmpegBinary)) &&
  fs.existsSync(ffprobeBinary);

const episode = (episodeNumber: number): TvdbEpisode => ({
  tag: `S01E0${episodeNumber}`,
  name: `Episode ${episodeNumber}`,
  seasonNumber: 1,
  episodeNumber,
});

function durationSeconds(file: string): number {
  const output = execFileSync(
    ffprobeBinary,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-print_format',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  return Number(JSON.parse(output).format.duration);
}

/**
 * Exercises the real bundled ffmpeg against a generated Matroska file. Input
 * seeking with stream copy can start a GOP early, so this guards the
 * keyframe-snapped cut points, exact-cut seeking and subtitle retiming.
 */
describe.skipIf(!canRun)('real ffmpeg split', () => {
  it('writes non-overlapping segments and retimed subtitles in both modes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-split-ffmpeg-'));
    try {
      const library = path.join(root, 'library', 'Show');
      fs.mkdirSync(library, { recursive: true });
      const source = path.join(library, 'S01E01-E02.mkv');
      execFileSync(
        ffmpegBinary as string,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=320x240:rate=25',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440',
          '-t',
          '12',
          '-c:v',
          'libx264',
          '-g',
          '50',
          '-keyint_min',
          '50',
          '-sc_threshold',
          '0',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-y',
          source,
        ],
        { stdio: 'ignore' },
      );
      const sidecar = path.join(library, 'S01E01-E02.en.srt');
      fs.writeFileSync(
        sidecar,
        '1\n00:00:01,000 --> 00:00:02,000\nFirst\n\n' +
          '2\n00:00:07,000 --> 00:00:08,000\nSecond\n',
      );

      const paths = appPaths({
        userDataPath: path.join(root, 'userData'),
        logsPath: path.join(root, 'logs'),
      });
      const item = {
        id: source,
        mediaType: 'tv',
        sourcePath: source,
        sourceRoot: path.join(root, 'library'),
        sourceRelativePath: 'Show/S01E01-E02.mkv',
        targetPath: source,
        relativeTarget: 'Show/S01E01-E02.mkv',
        action: 'skip',
        sidecars: [{ sourcePath: sidecar, targetPath: sidecar }],
        episode: episode(1),
        episodes: [episode(1), episode(2)],
      } as OrganizePlanItem;

      // The file has keyframes every 2 s, so the cut must snap to 6 s.
      const keyframes = await findKeyframesNear(source, [6], {
        windowSeconds: 3,
      });
      expect(keyframes[0]?.keyframeSeconds).toBeCloseTo(6, 1);

      const outDir = path.join(root, 'out');
      const segments: SplitSegment[] = [
        {
          index: 0,
          startSeconds: 0,
          endSeconds: 6,
          episode: episode(1),
          targetPath: path.join(outDir, 'S01E01.mkv'),
        },
        {
          index: 1,
          startSeconds: 6,
          endSeconds: 12,
          episode: episode(2),
          targetPath: path.join(outDir, 'S01E02.mkv'),
        },
      ];

      for (const cutMode of ['exact', 'copy'] as const) {
        const originalPolicy = cutMode === 'copy' ? 'backup' : 'keep';
        for (const segment of segments) {
          fs.rmSync(segment.targetPath as string, { force: true });
          fs.rmSync(`${segment.targetPath}.en.srt`, { force: true });
        }
        // Subtitle targets use the video's base name with the source suffix.
        if (fs.existsSync(outDir)) {
          for (const file of fs.readdirSync(outDir)) {
            if (file.endsWith('.en.srt')) {
              fs.rmSync(path.join(outDir, file), { force: true });
            }
          }
        }
        const plan: OrganizeSplitPlan = {
          itemId: source,
          sourcePath: source,
          fileSize: fs.statSync(source).size,
          fileDurationSeconds: 12,
          cutMode,
          originalPolicy,
          sidecarPolicy: 'split',
          estimate: { method: 'tvdb' },
          segments,
          updatedAt: 1,
        };
        const result = await executeSplitTask({ item, plan, segments }, paths);
        expect(result.warnings).toEqual([]);
        expect(result.outputs).toHaveLength(2);
        expect(result.sidecarOutputs).toHaveLength(2);
        for (const output of result.outputs) {
          expect(fs.statSync(output.targetPath).size).toBeGreaterThan(0);
        }
        if (cutMode === 'copy') {
          // The backup policy also moves the original's subtitle with it.
          expect(result.sidecarBackups).toHaveLength(1);
          expect(
            fs.existsSync(result.sidecarBackups?.[0].backupPath ?? ''),
          ).toBe(true);
          expect(fs.existsSync(sidecar)).toBe(false);
        }
        // Copy mode must not duplicate the previous segment's tail.
        expect(durationSeconds(result.outputs[0].targetPath)).toBeCloseTo(6, 0);
        expect(durationSeconds(result.outputs[1].targetPath)).toBeCloseTo(6, 0);
        const subtitles = fs
          .readdirSync(outDir)
          .filter((name) => name.endsWith('.srt'))
          .sort();
        expect(subtitles).toEqual(['S01E01.en.srt', 'S01E02.en.srt']);
        const firstSubtitle = fs.readFileSync(
          path.join(outDir, 'S01E01.en.srt'),
          'utf8',
        );
        expect(firstSubtitle).toContain('First');
        expect(firstSubtitle).not.toContain('Second');
        // The 7 s cue is retimed to about 1 s in the second episode.
        expect(
          fs.readFileSync(path.join(outDir, 'S01E02.en.srt'), 'utf8'),
        ).toMatch(/00:00:01,\d{3} --> 00:00:02,\d{3}\s+Second/);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('lands a copy cut on the file-relative keyframe of an offset source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-split-offset-'));
    try {
      const library = path.join(root, 'library', 'Show');
      fs.mkdirSync(library, { recursive: true });
      const source = path.join(library, 'S01E01-E02.mkv');
      // A 5.4 s container start offset reproduces files whose first PTS is not
      // zero. ffprobe reports absolute times; ffmpeg's segment muxer does not.
      execFileSync(
        ffmpegBinary as string,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=160x120:rate=25',
          '-t',
          '12',
          '-c:v',
          'libx264',
          '-g',
          '37',
          '-keyint_min',
          '37',
          '-sc_threshold',
          '0',
          '-pix_fmt',
          'yuv420p',
          '-output_ts_offset',
          '5.4',
          '-y',
          source,
        ],
        { stdio: 'ignore' },
      );

      const probe = await probeSplitSource(source);
      expect(probe.startTimeSeconds).toBeCloseTo(5.4, 1);

      // The keyframe is 11.32 s on the container timeline but 5.92 s into the
      // file; the editor and the muxer both work in file-relative time.
      const keyframes = await findKeyframesNear(source, [6], {
        windowSeconds: 3,
        startTimeSeconds: probe.startTimeSeconds,
      });
      expect(keyframes[0]?.keyframeSeconds).toBeCloseTo(5.92, 1);

      const paths = appPaths({
        userDataPath: path.join(root, 'userData'),
        logsPath: path.join(root, 'logs'),
      });
      const item = {
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
      const outDir = path.join(root, 'out');
      const segments: SplitSegment[] = [
        {
          index: 0,
          startSeconds: 0,
          endSeconds: 6,
          episode: episode(1),
          targetPath: path.join(outDir, 'S01E01.mkv'),
        },
        {
          index: 1,
          startSeconds: 6,
          endSeconds: 12,
          episode: episode(2),
          targetPath: path.join(outDir, 'S01E02.mkv'),
        },
      ];
      const plan: OrganizeSplitPlan = {
        itemId: source,
        sourcePath: source,
        fileSize: fs.statSync(source).size,
        fileDurationSeconds: 12,
        cutMode: 'copy',
        originalPolicy: 'keep',
        sidecarPolicy: 'leave',
        estimate: { method: 'tvdb' },
        segments,
        updatedAt: 1,
      };

      const result = await executeSplitTask({ item, plan, segments }, paths);
      expect(result.warnings).toEqual([]);
      // One GOP later would be about 11.9 s; the relative keyframe is 5.92 s.
      expect(durationSeconds(result.outputs[0].targetPath)).toBeCloseTo(6, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('detects black dividers with the bundled ffmpeg', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-split-black-'));
    try {
      const source = path.join(root, 'black.mkv');
      execFileSync(
        ffmpegBinary as string,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=white:s=160x120:r=25:d=12',
          '-vf',
          "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,4,6)'",
          '-c:v',
          'libx264',
          '-g',
          '25',
          '-pix_fmt',
          'yuv420p',
          '-y',
          source,
        ],
        { stdio: 'ignore' },
      );

      const seen: number[] = [];
      const intervals = await detectBlackIntervals(source, {
        executable: ffmpegBinary as string,
        onProgress: (seconds) => seen.push(seconds),
      });
      expect(intervals).toHaveLength(1);
      expect(intervals[0]?.startSeconds).toBeCloseTo(4, 0);
      expect(intervals[0]?.endSeconds).toBeCloseTo(6, 0);
      // The scan reports decoded time so the editor can show a percentage.
      expect(seen.length).toBeGreaterThan(0);
      expect(Math.max(...seen)).toBeGreaterThan(10);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
