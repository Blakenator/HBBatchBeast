#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs from `.husky/pre-commit`. Commits that change the shipped app must carry a
 * pending changeset.
 *
 * Nothing is flattened here: the `Changesets` workflow runs `changeset version`
 * on the default branch and opens the version pull request, which keeps the
 * pending entries on disk until then.
 */

/** Directories whose contents ship in the packaged app. */
const RELEASE_DIRECTORIES = ['src', 'packaging'];
/** Root-level files whose contents ship in the packaged app. */
const RELEASE_FILES = [
  'index.html',
  'forge.config.ts',
  'vite.main.config.mts',
  'vite.preload.config.mts',
  'vite.renderer.config.mts',
];
const SKIP_ENV = 'HBB_SKIP_CHANGESET_CHECK';
/** A commit cannot add a changeset while one of these operations is in flight. */
const IN_PROGRESS_MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-merge',
  'rebase-apply',
];

const log = (message) => console.log(`[changesets] ${message}`);
const fail = (message) => {
  console.error(`[changesets] ${message}`);
  return 1;
};

export function normalizeStagedPaths(paths) {
  return paths
    .map((entry) => entry.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter((entry) => entry.length > 0);
}

/** Splits a staged path into segments, dropping any absolute root. */
function splitStagedPath(stagedPath) {
  const normalized = normalizeStagedPaths([stagedPath])[0] ?? '';
  const isAbsolute =
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.startsWith('/');
  const segments = normalized
    .replace(/^[a-zA-Z]:/, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  return { segments, isAbsolute };
}

/**
 * True when the staged paths change the shipped app and therefore need a changeset.
 * Git always reports repo-relative paths, so top-level matching is the normal case;
 * absolute forms (drive letter or UNC) are matched by segment to stay robust.
 */
export function requiresChangeset(paths, platform = process.platform) {
  const fold = (value) =>
    platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;
  const directories = RELEASE_DIRECTORIES.map(fold);
  const files = RELEASE_FILES.map(fold);

  return paths.some((stagedPath) => {
    const { segments, isAbsolute } = splitStagedPath(stagedPath);
    if (segments.length === 0) return false;
    const folded = segments.map(fold);

    if (isAbsolute) {
      if (folded.some((segment) => directories.includes(segment))) return true;
      return files.includes(folded[folded.length - 1]);
    }
    if (directories.includes(folded[0])) return true;
    return folded.length === 1 && files.includes(folded[0]);
  });
}

/** Changeset files that have not been flattened yet. */
export function pendingChangesets(repoRoot) {
  const changesetDir = path.join(repoRoot, '.changeset');
  if (!fs.existsSync(changesetDir)) return [];
  return fs
    .readdirSync(changesetDir)
    .filter(
      (name) =>
        name.toLowerCase().endsWith('.md') &&
        name.toLowerCase() !== 'readme.md',
    )
    .sort();
}

function git(repoRoot, args, { quiet = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) return { ok: false, error: result.error };
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function inProgressOperation(repoRoot) {
  for (const marker of IN_PROGRESS_MARKERS) {
    const lookup = git(repoRoot, ['rev-parse', '--git-path', marker], {
      quiet: true,
    });
    if (!lookup.ok) continue;
    const markerPath = lookup.stdout.trim();
    if (markerPath && fs.existsSync(path.resolve(repoRoot, markerPath))) {
      return marker;
    }
  }
  return undefined;
}

function stagedFiles(repoRoot, diffFilter = 'ACMRD') {
  const result = git(
    repoRoot,
    ['diff', '--cached', '--name-only', `--diff-filter=${diffFilter}`, '-z'],
    { quiet: true },
  );
  if (!result.ok) throw new Error(result.error?.message ?? 'git diff failed');
  return normalizeStagedPaths(result.stdout.split('\0'));
}

/**
 * True when the index already contains a changeset flattened by a previous hook run,
 * so an aborted commit can be retried without minting a second changeset.
 */
export function hasFlattenedChangeset(paths) {
  return normalizeStagedPaths(paths).some((stagedPath) => {
    const segments = splitStagedPath(stagedPath).segments;
    return (
      segments.length === 2 &&
      segments[0] === '.changeset' &&
      segments[1].toLowerCase().endsWith('.md') &&
      segments[1].toLowerCase() !== 'readme.md'
    );
  });
}

export function parsePackageVersion(contents) {
  try {
    const parsed = JSON.parse(contents);
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/** True when the index carries a version bump that HEAD does not. */
export function hasStagedVersionBump(headContents, indexContents) {
  const before = parsePackageVersion(headContents);
  const after = parsePackageVersion(indexContents);
  return before !== undefined && after !== undefined && before !== after;
}

function stagedVersionBumped(repoRoot) {
  const head = git(repoRoot, ['show', 'HEAD:package.json'], { quiet: true });
  if (!head.ok) return false;
  const index = git(repoRoot, ['show', ':package.json'], { quiet: true });
  if (!index.ok) return false;
  return hasStagedVersionBump(head.stdout, index.stdout);
}

function main(repoRoot) {
  if (process.env[SKIP_ENV] === '1') {
    log(`Skipped because ${SKIP_ENV}=1.`);
    return 0;
  }

  const operation = inProgressOperation(repoRoot);
  if (operation) {
    log(`Skipped because a ${operation} is in progress.`);
    return 0;
  }

  const staged = stagedFiles(repoRoot);
  const changesets = pendingChangesets(repoRoot);
  const described =
    changesets.length > 0 ||
    hasFlattenedChangeset(stagedFiles(repoRoot, 'D')) ||
    stagedVersionBumped(repoRoot);

  if (requiresChangeset(staged) && !described) {
    return fail(
      'This commit changes app code but has no pending changeset.\n' +
        'Run `pnpm changeset`, then commit the generated `.changeset/*.md` with the change.\n' +
        'The Changesets workflow turns it into the next version and the release pull request.',
    );
  }

  if (changesets.length === 0) {
    log('No pending changesets to report.');
    return 0;
  }

  log(
    `Found ${changesets.length} pending changeset(s): ${changesets.join(', ')}`,
  );
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoLookup = git(process.cwd(), ['rev-parse', '--show-toplevel'], {
    quiet: true,
  });
  const repoRoot = repoLookup.ok ? repoLookup.stdout.trim() : process.cwd();
  process.exitCode = main(repoRoot);
}
