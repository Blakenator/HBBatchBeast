import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { move } from 'fs-extra';
import type { OrganizePlanItem } from '../../../common/organizer/types';
import type {
  OrganizeSplitPlan,
  SplitSegment,
} from '../../../common/organizer/split';
import type { AppPaths } from '../../helpers/appPaths';
import { sanitizePathSegment } from '../../../common/organizer/paths';
import { findSplitForItem } from '../../../common/organizer/split';
import {
  buildExactSplitArgs,
  buildSegmentCopyArgs,
  buildSubtitleCutArgs,
  FfmpegCancelledError,
  runFfmpeg,
  type FfmpegRunResult,
} from './execute';
import { findKeyframesNear, readMediaStartTime } from './probe';

export interface SplitRunResult {
  sourcePath: string;
  outputs: { targetPath: string; segment: SplitSegment }[];
  backupPath?: string;
  originalKept: boolean;
  warnings: string[];
  /** Subtitle files written for the segments; removed again on undo. */
  sidecarOutputs?: string[];
  /** Original sidecars moved into the backup; restored on undo. */
  sidecarBackups?: { sourcePath: string; backupPath: string }[];
}

export interface SplitTask {
  item: OrganizePlanItem;
  plan: OrganizeSplitPlan;
  /** Segments with a validated `targetPath`. */
  segments: SplitSegment[];
}

export interface SplitExecuteDeps {
  runFfmpeg?: typeof runFfmpeg;
  ffmpegPath?: string;
  signal?: AbortSignal;
  /** Reports the overall fraction (0..1) of this file's split. */
  onProgress?: (fraction: number) => void;
  /** Test hook that replaces the keyframe probe used by copy cuts. */
  findKeyframes?: typeof findKeyframesNear;
  /** Test hook that replaces the format start-offset probe. */
  probeStartTime?: typeof readMediaStartTime;
  /** Test hook that replaces the whole split (no filesystem probing). */
  splitFile?: (
    task: SplitTask,
    deps: SplitExecuteDeps,
  ) => Promise<SplitRunResult>;
}

const TEXT_SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'vtt']);

function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : '';
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function sidecarSuffix(videoPath: string, sidecarPath: string): string {
  const videoBase = stripExtension(path.basename(videoPath));
  const sidecarBase = stripExtension(path.basename(sidecarPath));
  return sidecarBase.toLowerCase().startsWith(videoBase.toLowerCase())
    ? sidecarBase.slice(videoBase.length)
    : '';
}

function sidecarTarget(
  videoTarget: string,
  sourceSidecar: string,
  suffix: string,
): string {
  const extension = extensionOf(sourceSidecar);
  const base = stripExtension(path.basename(videoTarget));
  const name = sanitizePathSegment(
    `${base}${suffix}${extension ? `.${extension}` : ''}`,
  );
  return path.join(path.dirname(videoTarget), name);
}

async function removeFileIfPresent(file: string): Promise<void> {
  try {
    await fs.promises.rm(file, { force: true });
  } catch {
    // Best effort.
  }
}

/**
 * Plans copy-mode cut timestamps. Cuts the editor already snapped carry their
 * keyframe in `cutSeconds` and are used as-is; only unsnapped cuts are probed.
 * Ordering is enforced so no segment is empty.
 */
export async function copyCutStarts(
  sourcePath: string,
  segments: SplitSegment[],
  probeKeyframes: typeof findKeyframesNear = findKeyframesNear,
  startTimeSeconds = 0,
): Promise<number[]> {
  const interior = segments.slice(1);
  if (interior.length === 0) return [0];
  const unsnapped = interior
    .filter((segment) => segment.cutSeconds === undefined)
    .map((segment) => segment.startSeconds);
  const cuts =
    unsnapped.length > 0
      ? await probeKeyframes(sourcePath, unsnapped, {
          windowSeconds: 10,
          minGapSeconds: 2,
          startTimeSeconds,
        })
      : [];
  const starts = [0];
  let cutIndex = 0;
  for (const segment of interior) {
    let snapped = segment.cutSeconds;
    if (snapped === undefined) {
      const cut = cuts[cutIndex];
      cutIndex += 1;
      snapped =
        cut?.keyframeSeconds ?? cut?.requestedSeconds ?? segment.startSeconds;
    }
    const previous = starts[starts.length - 1] ?? 0;
    starts.push(Math.max(snapped, previous + 1));
  }
  return starts;
}

/**
 * Executes one queued split: writes every segment to a temp file, moves them
 * into place, optionally splits external subtitles, then applies the original
 * file policy. The original is never touched until every segment succeeded.
 */
export async function executeSplitTask(
  task: SplitTask,
  appPaths: AppPaths,
  deps: SplitExecuteDeps = {},
): Promise<SplitRunResult> {
  if (deps.splitFile) return deps.splitFile(task, deps);
  const { plan, segments } = task;
  if (segments.some((segment) => !segment.targetPath)) {
    throw new Error('Every split segment needs a rendered target path.');
  }
  const run = deps.runFfmpeg ?? runFfmpeg;
  const executable = deps.ffmpegPath;
  const signal = deps.signal;
  const warnings: string[] = [];
  const outputs: { targetPath: string; segment: SplitSegment }[] = [];
  const sidecarOutputs: string[] = [];

  let starts: number[];
  if (plan.cutMode === 'copy') {
    const needsProbe = segments
      .slice(1)
      .some((segment) => segment.cutSeconds === undefined);
    const startTimeSeconds = needsProbe
      ? await (deps.probeStartTime ?? readMediaStartTime)(plan.sourcePath)
      : 0;
    starts = await copyCutStarts(
      plan.sourcePath,
      segments,
      deps.findKeyframes,
      startTimeSeconds,
    );
  } else {
    starts = [0, ...segments.slice(1).map((segment) => segment.startSeconds)];
  }
  const ends =
    plan.cutMode === 'copy'
      ? [...starts.slice(1), plan.fileDurationSeconds]
      : segments.map((segment, index) =>
          Math.max(
            (starts[index] ?? segment.startSeconds) + 0.1,
            segment.endSeconds,
          ),
        );

  try {
    if (plan.cutMode === 'copy') {
      await writeCopySegments(
        {
          plan,
          segments,
          starts,
          run,
          ...(executable ? { executable } : {}),
          ...(signal ? { signal } : {}),
          ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
        },
        outputs,
      );
    } else {
      for (const [index, segment] of segments.entries()) {
        if (signal?.aborted) throw new FfmpegCancelledError();
        const targetPath = segment.targetPath as string;
        const targetDirectory = path.dirname(targetPath);
        await fs.promises.mkdir(targetDirectory, { recursive: true });
        const extension = path.extname(targetPath);
        const tempPath = path.join(
          targetDirectory,
          `.hbb-split-${randomUUID()}${extension || `.${extensionOf(targetPath)}`}`,
        );
        const start = starts[index] ?? segment.startSeconds;
        const end = Math.max(start + 0.1, ends[index] ?? segment.endSeconds);
        try {
          await run(
            buildExactSplitArgs({
              sourcePath: plan.sourcePath,
              outputPath: tempPath,
              startSeconds: start,
              endSeconds: end,
            }),
            {
              ...(executable ? { executable } : {}),
              ...(signal ? { signal } : {}),
              onProgress: (progress) => {
                const fraction =
                  progress.outTimeSeconds !== undefined
                    ? Math.min(1, progress.outTimeSeconds / (end - start))
                    : 0;
                deps.onProgress?.((index + fraction) / segments.length);
              },
            },
          );
        } catch (error) {
          await removeFileIfPresent(tempPath);
          throw error;
        }
        let stat: { size: number } | undefined;
        try {
          stat = await fs.promises.stat(tempPath);
        } catch {
          stat = undefined;
        }
        if (!stat || stat.size === 0) {
          await removeFileIfPresent(tempPath);
          throw new Error(
            `ffmpeg produced no data for ${path.basename(targetPath)}.`,
          );
        }
        if (fs.existsSync(targetPath)) {
          await removeFileIfPresent(tempPath);
          throw new Error(`Target already exists: ${targetPath}`);
        }
        await fs.promises.rename(tempPath, targetPath);
        outputs.push({ targetPath, segment });
        deps.onProgress?.((index + 1) / segments.length);
      }
    }

    await applySidecars(task, deps, warnings, { starts, ends }, sidecarOutputs);
    const { backupPath, originalKept, sidecarBackups } =
      await applyOriginalPolicy(task, appPaths);
    return {
      sourcePath: plan.sourcePath,
      outputs,
      ...(backupPath ? { backupPath } : {}),
      originalKept,
      warnings,
      ...(sidecarOutputs.length > 0 ? { sidecarOutputs } : {}),
      ...(sidecarBackups.length > 0 ? { sidecarBackups } : {}),
    };
  } catch (error) {
    // A failed or cancelled split leaves no segment files behind, so retrying
    // and Undo both start from a clean state.
    for (const output of outputs) {
      await removeFileIfPresent(output.targetPath);
    }
    for (const sidecar of sidecarOutputs) {
      await removeFileIfPresent(sidecar);
    }
    throw error;
  }
}

interface CopySegmentOptions {
  plan: OrganizeSplitPlan;
  segments: SplitSegment[];
  /** Snapped keyframe starts, one per segment. */
  starts: number[];
  run: typeof runFfmpeg;
  executable?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * Stream-copies every segment in one ffmpeg pass. The segment muxer splits on
 * keyframes without duplicating the previous episode's tail, then each file is
 * moved onto its rendered target.
 */
async function writeCopySegments(
  options: CopySegmentOptions,
  outputs: { targetPath: string; segment: SplitSegment }[],
): Promise<void> {
  const firstTarget = options.segments[0]?.targetPath as string;
  const extension = path.extname(firstTarget);
  if (
    options.segments.some(
      (segment) => path.extname(segment.targetPath as string) !== extension,
    )
  ) {
    throw new Error('Every split segment must keep the source file extension.');
  }
  const tempDir = path.join(
    path.dirname(firstTarget),
    `.hbb-split-${randomUUID()}`,
  );
  await fs.promises.mkdir(tempDir, { recursive: true });
  try {
    await options.run(
      buildSegmentCopyArgs({
        sourcePath: options.plan.sourcePath,
        outputPattern: path.join(tempDir, `segment%04d${extension}`),
        segmentTimes: options.starts.slice(1),
      }),
      {
        ...(options.executable ? { executable: options.executable } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onProgress: (progress) => {
          if (
            progress.outTimeSeconds === undefined ||
            options.plan.fileDurationSeconds <= 0
          ) {
            return;
          }
          options.onProgress?.(
            Math.min(
              1,
              progress.outTimeSeconds / options.plan.fileDurationSeconds,
            ),
          );
        },
      },
    );
    const produced = (await fs.promises.readdir(tempDir))
      .filter((name) => name.startsWith('segment') && name.endsWith(extension))
      .sort();
    if (produced.length !== options.segments.length) {
      throw new Error(
        `ffmpeg produced ${produced.length} of ${options.segments.length} segment file(s).`,
      );
    }
    for (const [index, segment] of options.segments.entries()) {
      const targetPath = segment.targetPath as string;
      const tempPath = path.join(tempDir, produced[index]);
      const stat = await fs.promises.stat(tempPath);
      if (!stat.size) {
        throw new Error(
          `ffmpeg produced no data for ${path.basename(targetPath)}.`,
        );
      }
      if (fs.existsSync(targetPath)) {
        throw new Error(`Target already exists: ${targetPath}`);
      }
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      // `move` copies across devices, unlike rename.
      await move(tempPath, targetPath, { overwrite: false });
      outputs.push({ targetPath, segment });
      options.onProgress?.((index + 1) / options.segments.length);
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function applySidecars(
  task: SplitTask,
  deps: SplitExecuteDeps,
  warnings: string[],
  times: { starts: number[]; ends: number[] },
  sidecarOutputs: string[],
): Promise<void> {
  const { item, plan, segments } = task;
  const sidecars = item.sidecars.map((sidecar) => sidecar.sourcePath);
  if (sidecars.length === 0) return;
  if (plan.sidecarPolicy === 'leave') {
    warnings.push(
      `${sidecars.length} external subtitle file(s) stay with the original; embedded subtitles are split with the video.`,
    );
    return;
  }
  const run = deps.runFfmpeg ?? runFfmpeg;
  const executable = deps.ffmpegPath;
  for (const sidecar of sidecars) {
    const extension = extensionOf(sidecar);
    const suffix = sidecarSuffix(plan.sourcePath, sidecar);
    if (plan.sidecarPolicy === 'copy') {
      for (const segment of segments) {
        if (!segment.targetPath) continue;
        const target = sidecarTarget(segment.targetPath, sidecar, suffix);
        try {
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          await fs.promises.copyFile(sidecar, target);
          sidecarOutputs.push(target);
        } catch (error) {
          warnings.push(
            `Could not copy ${path.basename(sidecar)}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      warnings.push(
        `Full subtitle track copied to each segment; timings only match the first episode (${path.basename(sidecar)}).`,
      );
      continue;
    }
    if (!TEXT_SUBTITLE_EXTENSIONS.has(extension)) {
      warnings.push(
        `${path.basename(sidecar)} is not a text subtitle; it stays with the original.`,
      );
      continue;
    }
    for (const [index, segment] of segments.entries()) {
      if (!segment.targetPath) continue;
      const target = sidecarTarget(segment.targetPath, sidecar, suffix);
      const temp = `${target}.hbb-split.tmp`;
      // Cut the subtitles at the same keyframe-snapped starts as the video, so
      // copy-mode text tracks line up with their segment.
      const start = times.starts[index] ?? segment.startSeconds;
      const end = Math.max(
        start + 0.1,
        times.ends[index] ?? segment.endSeconds,
      );
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await run(
          buildSubtitleCutArgs({
            sourcePath: sidecar,
            outputPath: temp,
            startSeconds: start,
            endSeconds: end,
            format:
              extension === 'ass' || extension === 'ssa'
                ? 'ass'
                : extension === 'vtt'
                  ? 'webvtt'
                  : 'srt',
          }),
          { ...(executable ? { executable } : {}) },
        );
        await fs.promises.rename(temp, target);
        sidecarOutputs.push(target);
      } catch (error) {
        await removeFileIfPresent(temp);
        warnings.push(
          `Could not split subtitle ${path.basename(sidecar)} for segment ${segment.index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

async function applyOriginalPolicy(
  task: SplitTask,
  appPaths: AppPaths,
): Promise<{
  backupPath?: string;
  originalKept: boolean;
  sidecarBackups: { sourcePath: string; backupPath: string }[];
}> {
  const { item, plan } = task;
  if (plan.originalPolicy === 'keep') {
    return { originalKept: true, sidecarBackups: [] };
  }
  if (plan.originalPolicy === 'delete') {
    await fs.promises.rm(plan.sourcePath, { force: true });
    for (const sidecar of item.sidecars) {
      await fs.promises.rm(sidecar.sourcePath, { force: true });
    }
    return { originalKept: false, sidecarBackups: [] };
  }
  const relative = path.relative(item.sourceRoot, plan.sourcePath);
  const safeRelative =
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? relative
      : path.basename(plan.sourcePath);
  const backupRoot = path.join(
    appPaths.backupDir,
    'split-sources',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  const backupPath = path.join(backupRoot, safeRelative);
  await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
  await move(plan.sourcePath, backupPath, { overwrite: false });
  const sidecarBackups: { sourcePath: string; backupPath: string }[] = [];
  for (const sidecar of item.sidecars) {
    const sidecarRelative = path.relative(item.sourceRoot, sidecar.sourcePath);
    const safeSidecar =
      sidecarRelative &&
      !sidecarRelative.startsWith('..') &&
      !path.isAbsolute(sidecarRelative)
        ? sidecarRelative
        : path.basename(sidecar.sourcePath);
    const target = path.join(backupRoot, safeSidecar);
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await move(sidecar.sourcePath, target, { overwrite: false });
      sidecarBackups.push({
        sourcePath: sidecar.sourcePath,
        backupPath: target,
      });
    } catch {
      // A missing sidecar must not fail the split.
    }
  }
  return { backupPath, originalKept: false, sidecarBackups };
}

/** Convenience for the apply planner: resolve one split for one plan item. */
export function splitForItem(
  splits: readonly OrganizeSplitPlan[],
  item: OrganizePlanItem,
): OrganizeSplitPlan | undefined {
  return findSplitForItem(splits, item.id);
}

/** Small helper used by tests and the apply error path. */
export type { FfmpegRunResult };
