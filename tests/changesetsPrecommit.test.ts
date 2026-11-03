import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  hasFlattenedChangeset,
  hasStagedVersionBump,
  normalizeStagedPaths,
  parsePackageVersion,
  pendingChangesets,
  requiresChangeset,
} from '../scripts/changesets-precommit.mjs';

const tempRoots: string[] = [];

const makeTempRoot = (name: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), `hbb-${name}-`));
  tempRoots.push(root);
  return root;
};

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('normalizeStagedPaths', () => {
  it('normalizes separators and drops empty entries', () => {
    expect(
      normalizeStagedPaths([
        'src\\backend\\worker.ts',
        './docs/a.md',
        '  src/a.ts  ',
        '',
      ]),
    ).toEqual(['src/backend/worker.ts', 'docs/a.md', 'src/a.ts']);
  });

  it('keeps absolute POSIX, drive-letter and UNC roots intact', () => {
    expect(normalizeStagedPaths(['C:\\repo\\src\\app.ts'])).toEqual([
      'C:/repo/src/app.ts',
    ]);
    expect(normalizeStagedPaths(['\\\\server\\share\\src\\app.ts'])).toEqual([
      '//server/share/src/app.ts',
    ]);
    expect(normalizeStagedPaths(['/media/movies/app.ts'])).toEqual([
      '/media/movies/app.ts',
    ]);
  });
});

describe('requiresChangeset', () => {
  it('requires a changeset for shipped sources and build configuration', () => {
    for (const staged of [
      'src/backend/worker.ts',
      'src\\frontend\\App.tsx',
      './src/frontend/App.tsx',
      'index.html',
      'forge.config.ts',
      'vite.main.config.mts',
      'vite.preload.config.mts',
      'vite.renderer.config.mts',
      'packaging/desktop.ejs',
    ]) {
      expect(requiresChangeset([staged]), staged).toBe(true);
    }
  });

  it('accepts docs, tests, CI, tooling and changeset files', () => {
    for (const staged of [
      'docs/ui-design-intent.md',
      'tests/homePage.test.tsx',
      '.github/workflows/ci.yml',
      '.changeset/config.json',
      '.changeset/bright-cats-sing.md',
      'scripts/changesets-precommit.mjs',
      'README.md',
      'pnpm-lock.yaml',
      'docs/src/example.ts',
      'srcgen/app.ts',
    ]) {
      expect(requiresChangeset([staged]), staged).toBe(false);
    }
  });

  it('recognizes drive-letter and UNC paths', () => {
    expect(requiresChangeset(['C:/repo/src/backend/worker.ts'], 'win32')).toBe(
      true,
    );
    expect(
      requiresChangeset(['C:\\repo\\src\\backend\\worker.ts'], 'win32'),
    ).toBe(true);
    expect(requiresChangeset(['C:\\repo\\forge.config.ts'], 'win32')).toBe(
      true,
    );
    expect(requiresChangeset(['\\\\server\\share\\src\\app.ts'], 'win32')).toBe(
      true,
    );
    expect(requiresChangeset(['C:/repo/docs/guide.md'], 'win32')).toBe(false);
    expect(
      requiresChangeset(['\\\\server\\share\\docs\\guide.md'], 'win32'),
    ).toBe(false);
    expect(requiresChangeset(['/media/movies/src/app.ts'], 'linux')).toBe(true);
    expect(requiresChangeset(['/media/movies/docs/app.md'], 'linux')).toBe(
      false,
    );
  });

  it('matches release paths case-insensitively on Windows and macOS only', () => {
    expect(requiresChangeset(['SRC/App.tsx'], 'win32')).toBe(true);
    expect(requiresChangeset(['Src/App.tsx'], 'darwin')).toBe(true);
    expect(requiresChangeset(['SRC/App.tsx'], 'linux')).toBe(false);
  });
});

describe('hasFlattenedChangeset', () => {
  it('recognizes a changeset removed by a previous flatten', () => {
    expect(hasFlattenedChangeset(['.changeset/test-entry.md'])).toBe(true);
    expect(hasFlattenedChangeset(['./.changeset/test-entry.md'])).toBe(true);
    expect(hasFlattenedChangeset(['.changeset\\test-entry.md'])).toBe(true);
  });

  it('ignores app changes, the folder README and nested files', () => {
    expect(hasFlattenedChangeset(['src/app.ts'])).toBe(false);
    expect(hasFlattenedChangeset(['.changeset/README.md'])).toBe(false);
    expect(hasFlattenedChangeset(['.changeset/nested/entry.md'])).toBe(false);
  });
});

describe('hasStagedVersionBump', () => {
  it('detects a version bump between HEAD and the index', () => {
    expect(
      hasStagedVersionBump('{"version":"1.0.0"}', '{"version":"1.1.0"}'),
    ).toBe(true);
    expect(parsePackageVersion('{"version":"2.0.0"}')).toBe('2.0.0');
  });

  it('ignores unchanged, invalid and version-less manifests', () => {
    expect(
      hasStagedVersionBump('{"version":"1.0.0"}', '{"version":"1.0.0"}'),
    ).toBe(false);
    expect(hasStagedVersionBump('not json', '{"version":"1.1.0"}')).toBe(false);
    expect(hasStagedVersionBump('{"name":"x"}', '{"version":"1.1.0"}')).toBe(
      false,
    );
    expect(parsePackageVersion('nope')).toBeUndefined();
    expect(parsePackageVersion('{"version":2}')).toBeUndefined();
  });
});

describe('pendingChangesets', () => {
  it('lists markdown entries without the folder README', () => {
    const root = makeTempRoot('changesets');
    mkdirSync(path.join(root, '.changeset'));
    writeFileSync(path.join(root, '.changeset', 'config.json'), '{}');
    writeFileSync(path.join(root, '.changeset', 'README.md'), '# Changesets');
    writeFileSync(path.join(root, '.changeset', 'two.md'), '---');
    writeFileSync(path.join(root, '.changeset', 'one.md'), '---');
    writeFileSync(path.join(root, '.changeset', 'notes.txt'), 'ignored');

    expect(pendingChangesets(root)).toEqual(['one.md', 'two.md']);
  });

  it('returns nothing when the folder is missing or already flattened', () => {
    const emptyRoot = makeTempRoot('no-changesets');
    expect(pendingChangesets(emptyRoot)).toEqual([]);

    const flattenedRoot = makeTempRoot('flattened');
    mkdirSync(path.join(flattenedRoot, '.changeset'));
    writeFileSync(path.join(flattenedRoot, '.changeset', 'README.md'), '#');
    expect(pendingChangesets(flattenedRoot)).toEqual([]);
  });
});
