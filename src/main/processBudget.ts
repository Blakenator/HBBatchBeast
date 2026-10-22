import { execFileSync } from 'child_process';

/**
 * Startup guard against runaway encoder processes.
 *
 * The app owns short-lived CLI children (HandBrakeCLI preset scans and
 * conversions, FFmpeg/ffprobe). A UI bug once spawned them in a loop and
 * saturated the machine, so `--max-parallel <n>` makes startup refuse to
 * continue when more encoder processes are already running than the budget
 * allows.
 */
export interface ProcessCounts {
  encoders: number;
  appWorkers: number;
  total: number;
}

/** Processes the app spawns directly or through its child modules. */
const APP_WORKER_MODULES = [
  'backend/workers/worker1',
  'backend/scanner/queuebuild',
  'worker1.cjs',
  'queuebuild.cjs',
];

const ENCODER_NAMES = [
  'handbrakecli',
  'handbrakecli.exe',
  'ffmpeg',
  'ffmpeg.exe',
  'ffprobe',
  'ffprobe.exe',
];

export const MAX_PARALLEL_FLAG = '--max-parallel';
export const MAX_PARALLEL_ENV = 'HBB_MAX_PARALLEL';

let maxParallel: number | undefined;

function parsePositiveInteger(raw: string, source: string): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${source} must be a positive integer, received "${raw}".`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${source} must be at least 1, received "${raw}".`);
  }
  return value;
}

/**
 * Reads the budget from `--max-parallel <n>`, `--max-parallel=<n>` or
 * `HBB_MAX_PARALLEL`. Returns `undefined` when the guard is not configured.
 */
export function parseMaxParallel(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  let fromArgs: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === MAX_PARALLEL_FLAG) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`${MAX_PARALLEL_FLAG} needs a value.`);
      }
      fromArgs = next;
      index += 1;
    } else if (arg.startsWith(`${MAX_PARALLEL_FLAG}=`)) {
      fromArgs = arg.slice(MAX_PARALLEL_FLAG.length + 1);
    }
  }

  if (fromArgs !== undefined) {
    return parsePositiveInteger(fromArgs, MAX_PARALLEL_FLAG);
  }

  const fromEnv = env[MAX_PARALLEL_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return parsePositiveInteger(fromEnv, MAX_PARALLEL_ENV);
  }

  return undefined;
}

/** Splits a `ps -A -o comm=` listing into process names. */
export function parsePsCommListing(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Splits a `ps -A -o args=` listing into one command string per process. */
export function parsePsListing(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Splits `tasklist /FO CSV /NH` output into image names. */
export function parseTasklist(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map((line) => /^"([^"]+)"/.exec(line.trim())?.[1] ?? '')
    .filter((name) => name.length > 0);
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop()?.toLowerCase() ?? value.toLowerCase();
}

/** Encoder processes are matched on their executable name, not their args. */
export function countEncoderCommands(commNames: string[]): number {
  return commNames.filter((name) => ENCODER_NAMES.includes(basename(name))).length;
}

/**
 * Worker processes are node/electron children whose argv names one of the app's
 * child modules. Matching the module path keeps unrelated commands (a dev server
 * mentioning `ffprobe-static`, an editor passing the flag through) from being
 * counted as active conversions.
 */
export function countAppWorkerCommands(commandLines: string[]): number {
  return commandLines.filter((command) => {
    const lower = command.toLowerCase();
    const runsNode = /(^|[\\/\s])node(\.exe)?\s/.test(lower) || lower.includes('electron');
    return runsNode && APP_WORKER_MODULES.some((module) => lower.includes(module));
  }).length;
}

/** Counts encoder and app worker processes from a ps/tasklist snapshot. */
export function countProcesses(
  commNames: string[],
  commandLines: string[] = [],
): ProcessCounts {
  const encoders = countEncoderCommands(commNames);
  const appWorkers = countAppWorkerCommands(commandLines);
  return { encoders, appWorkers, total: encoders + appWorkers };
}

/** Reads the current process table. Returns `null` when it cannot be read. */
export function listRunningProcesses(): ProcessCounts | null {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      return countProcesses(parseTasklist(output));
    }
    const commOutput = execFileSync('ps', ['-A', '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 10000,
    });
    const argsOutput = execFileSync('ps', ['-A', '-o', 'args='], {
      encoding: 'utf8',
      timeout: 10000,
    });
    return countProcesses(
      parsePsCommListing(commOutput),
      parsePsListing(argsOutput),
    );
  } catch (error) {
    console.error('Unable to inspect running processes:', error);
    return null;
  }
}

/** Applies a budget to any process count; shared by startup and spawn guards. */
export function budgetExceeded(counts: ProcessCounts, limit: number): boolean {
  return counts.total > limit;
}

export function describeCounts(counts: ProcessCounts): string {
  return `${counts.total} encoder/worker process(es) running (${counts.encoders} encoder, ${counts.appWorkers} worker)`;
}

/**
 * Verifies the budget at startup. Throws with a fix-oriented message when more
 * encoder processes are already running than allowed.
 */
export function enforceProcessBudget(
  limit: number,
  listProcesses: () => ProcessCounts | null = listRunningProcesses,
): ProcessCounts {
  const counts = listProcesses();
  if (!counts) return { encoders: 0, appWorkers: 0, total: 0 };

  if (budgetExceeded(counts, limit)) {
    throw new Error(
      `${describeCounts(counts)}, which exceeds --max-parallel ${limit}. ` +
        'Stop the extra conversions or scans (or raise the limit) and start again.',
    );
  }
  return counts;
}

export function setMaxParallel(limit: number | undefined): void {
  maxParallel = limit;
}

export function getMaxParallel(): number | undefined {
  return maxParallel;
}

/** Spawn-time counterpart of the startup guard; `true` means "do not spawn". */
export function processBudgetReached(extra = 1): boolean {
  if (maxParallel === undefined) return false;
  const counts = listRunningProcesses();
  if (!counts) return false;
  return counts.total + extra > maxParallel;
}
