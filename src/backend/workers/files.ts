import { execFile } from 'child_process';
import fs from 'fs';
import { move } from 'fs-extra';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const LOG_FILES = {
  commandList: 'CommandList.txt',
  conversionLog: 'fileConversionLog.txt',
  errorLog: 'ErrorLog.txt',
  replacedList: 'originalFileReplacedList.txt',
  workerConsole: (workerNumber: number) =>
    `Worker${workerNumber}ConsoleOutput.txt`,
  workerConsoleError: (workerNumber: number) =>
    `Worker${workerNumber}ConsoleOutputError.txt`,
} as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Legacy log prefix: `DD-Month-YYYY#HH:MM:SS`. */
export function formatLogTimestamp(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}#${hours}:${minutes}:${seconds}`;
}

export async function ensureDirectory(directory: string): Promise<void> {
  await fs.promises.mkdir(directory, { recursive: true });
}

/** Log writes are best-effort: a full disk must not fail a conversion. */
export async function appendLog(
  logDirectory: string,
  fileName: string,
  text: string,
): Promise<void> {
  try {
    await ensureDirectory(logDirectory);
    await fs.promises.appendFile(path.join(logDirectory, fileName), text, 'utf8');
  } catch {
    // intentionally ignored
  }
}

export async function statSize(filePath: string): Promise<number | undefined> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Copy preserves the source extension for filtered/passthrough files. */
export function withSourceExtension(
  destinationPath: string,
  sourcePath: string,
): string {
  const sourceExtension = path.extname(sourcePath);
  const destinationExtension = path.extname(destinationPath);
  if (!sourceExtension || sourceExtension === destinationExtension) {
    return destinationPath;
  }
  return destinationExtension
    ? destinationPath.slice(0, -destinationExtension.length) + sourceExtension
    : destinationPath + sourceExtension;
}

export async function copyFile(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDirectory(path.dirname(destinationPath));
  await fs.promises.copyFile(sourcePath, destinationPath);
}

export async function moveFile(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDirectory(path.dirname(destinationPath));
  await move(sourcePath, destinationPath, { overwrite: true });
}

export async function removeFile(filePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes the original and moves the converted file into its folder. Returns
 * the path the converted file now occupies.
 */
export async function replaceOriginalFile(
  sourcePath: string,
  actualOutputPath: string,
): Promise<string> {
  const sourceDirectory = path.dirname(sourcePath);
  const target = path.join(sourceDirectory, path.basename(actualOutputPath));
  await removeFile(sourcePath);
  await moveFile(actualOutputPath, target);
  return target;
}

/** Runs a user-supplied batch/script file without a shell. */
export async function runCustomBat(batPath: string): Promise<void> {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    await execFileAsync('cmd.exe', ['/c', batPath], {
      windowsHide: true,
      timeout: 60_000,
    });
    return;
  }
  await execFileAsync(batPath, [], { timeout: 60_000 });
}
