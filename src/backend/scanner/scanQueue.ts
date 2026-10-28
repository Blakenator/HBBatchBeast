import fs from 'fs/promises';
import path from 'path';
import { fileTypeGate } from '../../common/filterExpression';
import type { FilterTrace } from '../../common/filterExpression';
import type { PresetTrace } from '../../common/library';
import {
  ExclusionCode,
  QueueBuildConfig,
  QueueBuildResult,
  ScanExclusion,
} from '../processes/protocol';
import { runFfprobe, type RawProbe } from '../helpers/ffprobe';
import {
  FilterEvaluationContext,
  evaluateFilterExpression,
  filterTraceReason,
  skippedFilterTrace,
  OutputState,
} from './filterEvaluation';
import { outputRelativePath } from './destination';
import { resolvePresetForFile } from './presetResolution';

export interface ScanQueueCallbacks {
  onProgress?: (phase: 'discovered' | 'queued', count: number) => void;
  onLog?: (message: string) => void;
}

interface WalkedFile {
  source: string;
  originalSource: string;
  relative: string;
  extension: string;
  destination: string;
  destinationFinal: string | null;
  isSidecar: boolean;
  /** Fallback preset from the library/source row. */
  preset: string;
  folderId: string;
}

interface Candidate extends WalkedFile {
  /** Why the scanner will not convert this file; null when it will. */
  exclusion: ScanExclusion | null;
  trace: QueueBuildResult['traces'][number];
  presetTrace?: PresetTrace;
  /** True when the destination had no usable output yet. */
  unconverted: boolean;
}

const PROGRESS_INTERVAL = 100;
const EVALUATION_CONCURRENCY = 4;

/**
 * Reads the source tree once, then evaluates the filter expression over the
 * candidates with bounded concurrency. Property rules probe lazily so files
 * rejected by a cheaper stage never pay the ffprobe cost.
 */
export async function scanQueue(
  config: QueueBuildConfig,
  callbacks: ScanQueueCallbacks = {},
): Promise<QueueBuildResult> {
  const log = (message: string) => callbacks.onLog?.(message);
  const progress = (phase: 'discovered' | 'queued', count: number) => {
    if (count % PROGRESS_INTERVAL === 0) callbacks.onProgress?.(phase, count);
  };

  const gate = fileTypeGate(config.filterExpression);
  const replacedFiles = await readReplacedFiles(config);
  const untrustedOutputs = new Set(config.untrustedOutputs);
  const walked: WalkedFile[] = [];
  let typeFiltered = 0;

  for (let index = 0; index < config.sources.length; index += 1) {
    const sourceRoot = config.sources[index];
    const destinationRoot = config.destinations[index];
    const finalRoot = config.useTempFolder
      ? config.tempDestinations[index]
      : undefined;
    const suffix = config.fileSuffixes[index] ?? '';
    const preset = config.presets[index] ?? '';
    const folderId = config.folderIds?.[index] ?? `source-${index}`;

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        log(
          `Skipping unreadable folder "${directory}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }

        const extension = path.extname(entry.name).slice(1).toLowerCase();
        const isSidecar = config.copySrtFiles && extension === 'srt';
        if (!isSidecar && gate && !gate.has(extension)) {
          typeFiltered += 1;
          continue;
        }

        let filePath = absolute;
        if (config.removeApostrophes && entry.name.includes("'")) {
          const renamed = path.join(directory, entry.name.replace(/'/g, ' '));
          try {
            await fs.rename(filePath, renamed);
            filePath = renamed;
          } catch (error) {
            log(
              `Could not remove apostrophes from "${absolute}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            continue;
          }
        }

        const relative = path.relative(sourceRoot, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          log(`Skipping file outside its source folder: ${filePath}`);
          continue;
        }

        const outputRelative = outputRelativePath(
          relative,
          suffix,
          config.container,
        );
        const destination = path.join(destinationRoot, outputRelative);
        const destinationFinal = finalRoot
          ? path.join(finalRoot, outputRelative)
          : null;

        walked.push({
          source: filePath,
          originalSource: absolute,
          relative,
          extension,
          destination,
          destinationFinal,
          isSidecar,
          preset,
          folderId,
        });
        progress('discovered', walked.length);
      }
    };

    await walk(sourceRoot);
  }

  const queue: Candidate[] = new Array(walked.length);
  let completed = 0;
  let nextIndex = 0;

  const evaluateNext = async (): Promise<void> => {
    while (nextIndex < walked.length) {
      const index = nextIndex;
      nextIndex += 1;
      queue[index] = await evaluateCandidate(
        walked[index],
        config,
        replacedFiles,
        untrustedOutputs,
        log,
      );
      completed += 1;
      progress('queued', completed);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(EVALUATION_CONCURRENCY, walked.length) },
      () => evaluateNext(),
    ),
  );

  if (config.reverseQueue) queue.reverse();

  log(
    `File scanner: Finished (${queue.length} queued, ${walked.length} found, ${typeFiltered} ignored by type)`,
  );

  return {
    total: walked.length,
    sources: queue.map((candidate) => candidate.source),
    presets: queue.map((candidate) => candidate.preset),
    skipOrCopy: queue.map((candidate) => (candidate.exclusion ? 1 : 0)),
    excluded: queue.map((candidate) => candidate.exclusion),
    destinations: queue.map((candidate) => candidate.destination),
    destinationsFinal: queue.map((candidate) => candidate.destinationFinal),
    traces: queue.map((candidate) => candidate.trace),
    presetTraces: queue.map((candidate) => candidate.presetTrace ?? null),
    typeFiltered,
    notExists: queue.filter((candidate) => candidate.unconverted).length,
  };
}

async function evaluateCandidate(
  file: WalkedFile,
  config: QueueBuildConfig,
  replacedFiles: Set<string>,
  untrustedOutputs: Set<string>,
  log: (message: string) => void,
): Promise<Candidate> {
  await ensureDirectory(path.dirname(file.destination));
  if (file.destinationFinal) {
    await ensureDirectory(path.dirname(file.destinationFinal));
  }

  const target = file.destinationFinal ?? file.destination;
  const untrusted =
    untrustedOutputs.has(target) || untrustedOutputs.has(file.destination);
  const hasExisting = !untrusted && (await isConverted(target));
  const replaced =
    replacedFiles.has(file.source) || replacedFiles.has(file.originalSource);

  const outputState: OutputState = replaced
    ? 'replaced'
    : hasExisting
      ? 'converted'
      : untrusted
        ? 'untrusted'
        : 'empty';

  let trace: FilterTrace;
  let evaluationContext: FilterEvaluationContext | undefined;
  let probePromise: Promise<RawProbe | undefined> | undefined;
  const probe = (): Promise<RawProbe | undefined> => {
    if (!probePromise) {
      probePromise = runFfprobe(file.source).catch((error): undefined => {
        log(
          `ffprobe failed for "${file.source}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      });
    }
    return probePromise;
  };

  if (file.isSidecar) {
    trace = skippedFilterTrace(
      config.filterExpression,
      'Subtitle sidecar copied without conversion',
    );
  } else {
    const sourceStats = await fs.stat(file.source).catch((): undefined => undefined);
    evaluationContext = {
      fileName: path.basename(file.source),
      extension: file.extension,
      folderId: file.folderId,
      relativePath: file.relative,
      ...(sourceStats ? { sizeBytes: sourceStats.size } : {}),
      outputState,
    };
    trace = await evaluateFilterExpression(config.filterExpression, evaluationContext, {
      probe,
    });
  }

  let exclusion: ScanExclusion | null = null;
  if (file.isSidecar && !replaced) {
    exclusion = {
      code: 'subtitle',
      reason: 'Subtitle file (copied, not converted)',
    };
  } else if (replaced) {
    // A replaced original is never converted again, even when the user asks to
    // include already-converted files. Surface it as a failed system stage.
    const entryId = 'system-already-replaced';
    trace = {
      ...trace,
      entries: [
        {
          ruleId: entryId,
          groupPath: [config.filterExpression.root.id],
          field: 'outputState',
          operator: 'is',
          value: 'converted',
          negate: false,
          status: 'fail',
          observed: 'replaced',
          detail: 'Already replaced (see replaced-files log)',
        },
        ...trace.entries,
      ],
      groupOutcomes: {
        ...trace.groupOutcomes,
        [config.filterExpression.root.id]: 'fail',
      },
      outcome: 'excluded',
      excludedBy: entryId,
    };
    exclusion = {
      code: 'alreadyReplaced',
      reason: 'Already replaced (see replaced-files log)',
    };
  } else if (trace.outcome === 'excluded') {
    const code = exclusionCode(outputState);
    exclusion = {
      code,
      reason:
        code === 'alreadyConverted'
          ? 'Already converted'
          : filterTraceReason(trace) ?? 'Excluded by the file filter',
    };
  }

  let preset = file.preset;
  let presetTrace: PresetTrace | undefined;
  const hasMapping =
    (config.mappingRules?.length ?? 0) > 0 ||
    (config.presetCatalog?.length ?? 0) > 0;
  if (!exclusion && !file.isSidecar && evaluationContext && hasMapping) {
    const resolved = await resolvePresetForFile({
      rules: config.mappingRules ?? [],
      catalog: config.presetCatalog ?? [],
      defaultPresetId: config.defaultPresetId ?? '',
      defaultArgument: config.defaultPreset ?? file.preset,
      context: evaluationContext,
      probe,
    });
    preset = resolved.argument;
    presetTrace = resolved.trace;
  }

  return {
    ...file,
    preset,
    exclusion,
    trace,
    ...(presetTrace ? { presetTrace } : {}),
    unconverted:
      outputState === 'empty' ||
      outputState === 'untrusted' ||
      (!file.isSidecar && trace.outcome === 'included'),
  };
}

function exclusionCode(outputState: OutputState): ExclusionCode {
  // Existing output wins over a rule reason so copy-filtered-files can never
  // overwrite a completed conversion, even when another stage failed first.
  if (outputState === 'converted') return 'alreadyConverted';
  if (outputState === 'replaced') return 'alreadyReplaced';
  return 'filtered';
}

async function readReplacedFiles(
  config: QueueBuildConfig,
): Promise<Set<string>> {
  if (!config.replaceIfSmaller && !config.replaceAlways) return new Set();
  const file = path.join(config.logDirectory, 'originalFileReplacedList.txt');
  try {
    const contents = await fs.readFile(file, 'utf8');
    return new Set(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
  } catch {
    return new Set();
  }
}

/**
 * A destination only counts as converted when it has content. Encoders create
 * an empty file as soon as they start, so a crashed/cancelled run must be
 * picked up again on the next scan.
 */
async function isConverted(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch {
    // The conversion will report the write failure; scanning should continue.
  }
}
