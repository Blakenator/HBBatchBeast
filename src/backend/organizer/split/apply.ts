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
import {
  isCaseInsensitivePlatform,
  sanitizePathSegment,
} from '../../../common/organizer/paths';
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

export interface SplitRunOutput {
  targetPath: string;
  segment: SplitSegment;
  /** Where a file replaced by the overwrite option was moved for undo. */
  replacedBackupPath?: string;
}

export interface SplitRunResult {
  sourcePath: string;
  outputs: SplitRunOutput[];
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

/** Compares absolute paths, case-insensitively on Windows and macOS. */
function sameFilePath(left: string, right: string): boolean {
  const caseInsensitive = isCaseInsensitivePlatform(process.platform);
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return caseInsensitive ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

/**
 * Makes a target writable. Existing files are moved into the backup folder
 * first so an overwrite can still be undone and a failed write can restore the
 * previous file.
 */
async function prepareTargetForWrite(
  targetPath: string,
  sourcePath: string,
  overwrite: boolean,
  overwriteRoot: string | undefined,
  index: number,
): Promise<string | undefined> {
  if (sameFilePath(targetPath, sourcePath)) {
    throw new Error(
      `A split segment would overwrite its own source: ${targetPath}`,
    );
  }
  if (!fs.existsSync(targetPath)) return undefined;
  if (!overwrite || !overwriteRoot) {
    throw new Error(`Target already exists: ${targetPath}`);
  }
  await fs.promises.mkdir(overwriteRoot, { recursive: true });
  const extension = path.extname(targetPath);
  const base = path.basename(targetPath, extension);
  const backupPath = path.join(
    overwriteRoot,
    `${index}-${randomUUID()}-${sanitizePathSegment(base)}${extension}`,
  );
  await move(targetPath, backupPath, { overwrite: false });
  return backupPath;
}

async function restoreReplacedTarget(
  targetPath: string,
  backupPath: string | undefined,
): Promise<void> {
  if (!backupPath) {
    await removeFileIfPresent(targetPath);
    return;
  }
  try {
    if (!fs.existsSync(backupPath)) return;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await move(backupPath, targetPath, { overwrite: true });
  } catch {
    // Leave the new file in place; the previous file is still in the backup.
  }
}

async function rollbackOutput(output: SplitRunOutput): Promise<void> {
  await restoreReplacedTarget(output.targetPath, output.replacedBackupPath);
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
  const skipped = new Set(plan.skippedSegments ?? []);
  const activeSegments = segments.filter(
    (segment) => !skipped.has(segment.index),
  );
  if (activeSegments.length === 0) {
    throw new Error('Every segment of this split is skipped.');
  }
  if (activeSegments.some((segment) => !segment.targetPath)) {
    throw new Error('Every split segment needs a rendered target path.');
  }
  const run = deps.runFfmpeg ?? runFfmpeg;
  const executable = deps.ffmpegPath;
  const signal = deps.signal;
  const warnings: string[] = [];
  const outputs: SplitRunOutput[] = [];
  const sidecarOutputs: string[] = [];
  /** Existing subtitle files moved aside so Undo can restore them. */
  const replacedSidecars: { sourcePath: string; backupPath: string }[] = [];
  const overwrite = plan.overwrite === true;
  const overwriteRoot = overwrite
    ? path.join(
        appPaths.backupDir,
        'split-overwrites',
        new Date().toISOString().replace(/[:.]/g, '-'),
        randomUUID(),
      )
    : undefined;

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
          skipped,
          starts,
          overwrite,
          ...(overwriteRoot ? { overwriteRoot } : {}),
          run,
          ...(executable ? { executable } : {}),
          ...(signal ? { signal } : {}),
          ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
        },
        outputs,
      );
    } else {
      let activeIndex = 0;
      for (const [index, segment] of segments.entries()) {
        if (skipped.has(segment.index)) continue;
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
                deps.onProgress?.(
                  (activeIndex + fraction) / activeSegments.length,
                );
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
        let replacedBackupPath: string | undefined;
        try {
          replacedBackupPath = await prepareTargetForWrite(
            targetPath,
            plan.sourcePath,
            overwrite,
            overwriteRoot,
            index,
          );
          await move(tempPath, targetPath, {
            overwrite: Boolean(replacedBackupPath),
          });
        } catch (error) {
          await removeFileIfPresent(tempPath);
          if (replacedBackupPath) {
            await restoreReplacedTarget(targetPath, replacedBackupPath);
          }
          throw error;
        }
        outputs.push({
          targetPath,
          segment,
          ...(replacedBackupPath ? { replacedBackupPath } : {}),
        });
        activeIndex += 1;
        deps.onProgress?.(activeIndex / activeSegments.length);
      }
    }

    if (outputs.some((output) => output.replacedBackupPath)) {
      warnings.push(
        `${outputs.filter((output) => output.replacedBackupPath).length} existing file(s) were replaced; Undo restores them.`,
      );
    }

    await applySidecars(
      task,
      deps,
      warnings,
      { starts, ends },
      sidecarOutputs,
      skipped,
      overwriteRoot,
      replacedSidecars,
    );
    const { backupPath, originalKept, sidecarBackups } =
      await applyOriginalPolicy(task, appPaths);
    const allSidecarBackups = [...sidecarBackups, ...replacedSidecars];
    return {
      sourcePath: plan.sourcePath,
      outputs,
      ...(backupPath ? { backupPath } : {}),
      originalKept,
      warnings,
      ...(sidecarOutputs.length > 0 ? { sidecarOutputs } : {}),
      ...(allSidecarBackups.length > 0
        ? { sidecarBackups: allSidecarBackups }
        : {}),
    };
  } catch (error) {
    // A failed or cancelled split leaves no segment files behind, so retrying
    // and Undo both start from a clean state. Overwritten files are restored.
    for (const output of outputs) {
      await rollbackOutput(output);
    }
    for (const sidecar of sidecarOutputs) {
      await removeFileIfPresent(sidecar);
    }
    for (const sidecar of replacedSidecars) {
      await restoreReplacedTarget(sidecar.sourcePath, sidecar.backupPath);
    }
    throw error;
  }
}

interface CopySegmentOptions {
  plan: OrganizeSplitPlan;
  segments: SplitSegment[];
  /** Segment indexes that are cut for timeline correctness but not written. */
  skipped: Set<number>;
  /** Snapped keyframe starts, one per segment. */
  starts: number[];
  overwrite: boolean;
  overwriteRoot?: string;
  run: typeof runFfmpeg;
  executable?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * Stream-copies every segment in one ffmpeg pass. The segment muxer splits on
 * keyframes without duplicating the previous episode's tail, then each file is
 * moved onto its rendered target. Skipped segments are still cut so the
 * remaining segments keep their exact boundaries, then discarded.
 */
async function writeCopySegments(
  options: CopySegmentOptions,
  outputs: SplitRunOutput[],
): Promise<void> {
  const activeSegments = options.segments.filter(
    (segment) => !options.skipped.has(segment.index),
  );
  const firstTarget = activeSegments[0]?.targetPath as string;
  const extension = path.extname(firstTarget);
  if (
    activeSegments.some(
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
            0.9 *
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
    let written = 0;
    for (const [index, segment] of options.segments.entries()) {
      if (options.skipped.has(segment.index)) continue;
      const targetPath = segment.targetPath as string;
      const tempPath = path.join(tempDir, produced[index]);
      const stat = await fs.promises.stat(tempPath);
      if (!stat.size) {
        throw new Error(
          `ffmpeg produced no data for ${path.basename(targetPath)}.`,
        );
      }
      let replacedBackupPath: string | undefined;
      try {
        replacedBackupPath = await prepareTargetForWrite(
          targetPath,
          options.plan.sourcePath,
          options.overwrite,
          options.overwriteRoot,
          index,
        );
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        // `move` copies across devices, unlike rename.
        await move(tempPath, targetPath, {
          overwrite: Boolean(replacedBackupPath),
        });
      } catch (error) {
        if (replacedBackupPath) {
          await restoreReplacedTarget(targetPath, replacedBackupPath);
        }
        throw error;
      }
      outputs.push({
        targetPath,
        segment,
        ...(replacedBackupPath ? { replacedBackupPath } : {}),
      });
      written += 1;
      options.onProgress?.(0.9 + (0.1 * written) / activeSegments.length);
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
  skipped: Set<number>,
  overwriteRoot: string | undefined,
  sidecarBackups: { sourcePath: string; backupPath: string }[],
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
  /**
   * Makes a subtitle target writable. An existing file is moved into the
   * overwrite backup so Undo can restore it, matching the media behavior.
   */
  const clearTarget = async (
    target: string,
    index: number,
  ): Promise<{ skip: boolean; backupPath?: string }> => {
    if (!fs.existsSync(target)) return { skip: false };
    if (!overwriteRoot) return { skip: true };
    const extension = path.extname(target);
    const base = path.basename(target, extension);
    const directory = path.join(overwriteRoot, 'sidecars');
    await fs.promises.mkdir(directory, { recursive: true });
    const backupPath = path.join(
      directory,
      `${index}-${randomUUID()}-${sanitizePathSegment(base)}${extension}`,
    );
    await move(target, backupPath, { overwrite: false });
    sidecarBackups.push({ sourcePath: target, backupPath });
    return { skip: false, backupPath };
  };
  const warnExisting = (target: string) => {
    warnings.push(
      `Existing subtitle ${path.basename(target)} was left in place; enable overwrite to replace it.`,
    );
  };
  const run = deps.runFfmpeg ?? runFfmpeg;
  const executable = deps.ffmpegPath;
  for (const sidecar of sidecars) {
    const extension = extensionOf(sidecar);
    const suffix = sidecarSuffix(plan.sourcePath, sidecar);
    if (plan.sidecarPolicy === 'copy') {
      for (const segment of segments) {
        if (!segment.targetPath || skipped.has(segment.index)) continue;
        const target = sidecarTarget(segment.targetPath, sidecar, suffix);
        try {
          const cleared = await clearTarget(target, segment.index);
          if (cleared.skip) {
            warnExisting(target);
            continue;
          }
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
      if (!segment.targetPath || skipped.has(segment.index)) continue;
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
        const cleared = await clearTarget(target, segment.index);
        if (cleared.skip) {
          warnExisting(target);
          continue;
        }
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
