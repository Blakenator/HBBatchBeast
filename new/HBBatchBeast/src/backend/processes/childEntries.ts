import fs from 'fs';
import path from 'path';
import { AppError } from '@superflag/super-ipc-core';

/**
 * Child modules are separate Vite build entries (see `forge.config.ts`), emitted
 * next to `main.cjs`. Resolving them through a named map keeps the filenames in
 * one place and lets us fail fast with an actionable message instead of a
 * runtime MODULE_NOT_FOUND.
 */
export const CHILD_ENTRIES = {
  queueBuild: 'queueBuild.cjs',
  worker1: 'worker1.cjs',
} as const;

export type ChildEntryName = keyof typeof CHILD_ENTRIES;

function defaultBaseDir(): string {
  return typeof __dirname === 'string' ? __dirname : process.cwd();
}

export function resolveChildEntry(
  name: ChildEntryName,
  baseDir: string = defaultBaseDir(),
): string {
  const file = path.join(baseDir, CHILD_ENTRIES[name]);
  if (!fs.existsSync(file)) {
    throw new AppError(
      `Child process module "${name}" is missing from the build output`,
      { context: { expectedPath: file, baseDir } },
    );
  }
  return file;
}

/** Called once at startup so a broken build fails immediately and clearly. */
export function validateChildEntries(baseDir?: string): void {
  for (const name of Object.keys(CHILD_ENTRIES) as ChildEntryName[]) {
    resolveChildEntry(name, baseDir);
  }
}

/** Source paths used by tests, where modules are run from `src/`. */
export const CHILD_ENTRY_SOURCES = {
  queueBuild: 'queueBuild.js',
} as const;
