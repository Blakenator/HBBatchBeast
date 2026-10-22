import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import { AppError } from '@superflag/super-ipc-core';

/** Resolves a user-supplied folder path and rejects anything that is not an existing directory. */
export function assertExistingFolder(target: string): string {
  const trimmed = target?.trim();
  if (!trimmed) {
    throw new AppError('No folder path was provided');
  }

  const resolved = path.resolve(trimmed);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch (error) {
    throw new AppError('Folder not found', {
      inner: error instanceof Error ? error : undefined,
      context: { path: resolved },
    });
  }

  if (!stats.isDirectory()) {
    throw new AppError('Path is not a folder', { context: { path: resolved } });
  }

  return resolved;
}

/** Opens a media/config folder in the OS file manager. */
export async function openFolder(target: string): Promise<void> {
  const resolved = assertExistingFolder(target);
  const error = await shell.openPath(resolved);
  if (error) {
    throw new AppError('Could not open folder', {
      context: { path: resolved, error },
    });
  }
}
