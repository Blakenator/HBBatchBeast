import fs from 'fs/promises';
import path from 'path';
import { parseTokenList } from '../../common/configValues';
import {
  ExclusionCode,
  QueueBuildConfig,
  QueueBuildResult,
  ScanExclusion,
} from '../processes/protocol';
import { outputRelativePath } from './destination';

export interface ScanQueueCallbacks {
  onProgress?: (phase: 'discovered' | 'queued', count: number) => void;
  onLog?: (message: string) => void;
}

interface Candidate {
  source: string;
  preset: string;
  destination: string;
  destinationFinal: string | null;
  /** Why the scanner will not convert this file; null when it will. */
  exclusion: ScanExclusion | null;
}

const PROGRESS_INTERVAL = 100;

/**
 * Single-pass recursive scan. Builds the queue while walking so the file list
 * is never materialized twice (the legacy module collected everything, then
 * filtered it in a second loop).
 */
export async function scanQueue(
  config: QueueBuildConfig,
  callbacks: ScanQueueCallbacks = {},
): Promise<QueueBuildResult> {
  const log = (message: string) => callbacks.onLog?.(message);
  const progress = (phase: 'discovered' | 'queued', count: number) => {
    if (count % PROGRESS_INTERVAL === 0) callbacks.onProgress?.(phase, count);
  };

  const supportedTypes = new Set(
    parseTokenList(config.includedFileTypes).map((type) => type.toLowerCase()),
  );
  const titleWords = parseTokenList(config.titleWordFilter);
  const replacedFiles = await readReplacedFiles(config);
  const untrustedOutputs = new Set(config.untrustedOutputs);

  let total = 0;
  let notExists = 0;
  const queue: Candidate[] = [];

  for (let index = 0; index < config.sources.length; index += 1) {
    const sourceRoot = config.sources[index];
    const destinationRoot = config.destinations[index];
    const finalRoot = config.useTempFolder
      ? config.tempDestinations[index]
      : undefined;
    const suffix = config.fileSuffixes[index] ?? '';
    const preset = config.presets[index] ?? '';

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
        if (!supportedTypes.has(extension)) continue;

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

        const alreadyReplaced =
          replacedFiles.has(filePath) ||
          (filePath !== absolute && replacedFiles.has(absolute));

        total += 1;
        progress('discovered', total);

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

        const target = destinationFinal ?? destination;
        const converted =
          !untrustedOutputs.has(target) &&
          !untrustedOutputs.has(destination) &&
          (await isConverted(target));
        if (!converted) notExists += 1;

        await ensureDirectory(path.dirname(destination));
        if (destinationFinal) {
          await ensureDirectory(path.dirname(destinationFinal));
        }

        const baseName = path.basename(relative, path.extname(relative));
        const matchedTitleWord = titleWords.find((word) =>
          baseName.includes(word),
        );

        queue.push({
          source: filePath,
          preset,
          destination,
          destinationFinal,
          exclusion: exclusionReason({
            alreadyReplaced,
            converted,
            matchedTitleWord,
            extension,
          }),
        });
        progress('queued', queue.length);
      }
    };

    await walk(sourceRoot);
  }

  if (config.reverseQueue) queue.reverse();

  log(`File scanner: Finished (${queue.length} queued, ${total} found)`);

  return {
    total,
    sources: queue.map((candidate) => candidate.source),
    presets: queue.map((candidate) => candidate.preset),
    skipOrCopy: queue.map((candidate) => (candidate.exclusion ? 1 : 0)),
    excluded: queue.map((candidate) => candidate.exclusion),
    destinations: queue.map((candidate) => candidate.destination),
    destinationsFinal: queue.map((candidate) => candidate.destinationFinal),
    notExists,
  };
}

interface ExclusionInput {
  alreadyReplaced: boolean;
  converted: boolean;
  matchedTitleWord: string | undefined;
  extension: string;
}

const EXCLUSION_REASONS: Record<ExclusionCode, string> = {
  alreadyReplaced: 'Already replaced (see replaced-files log)',
  alreadyConverted: 'Already converted',
  titleMatch: 'Title matches the title word filter',
  subtitle: 'Subtitle file (copied, not converted)',
};

/** First matching exclusion wins; null means the file will be converted. */
function exclusionReason(input: ExclusionInput): ScanExclusion | null {
  const withReason = (code: ExclusionCode, extra?: string): ScanExclusion => ({
    code,
    reason: extra ? `${EXCLUSION_REASONS[code]}: "${extra}"` : EXCLUSION_REASONS[code],
  });

  if (input.alreadyReplaced) return withReason('alreadyReplaced');
  if (input.converted) return withReason('alreadyConverted');
  if (input.matchedTitleWord !== undefined) {
    return withReason('titleMatch', input.matchedTitleWord);
  }
  if (input.extension === 'srt') return withReason('subtitle');
  return null;
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
