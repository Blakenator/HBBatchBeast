import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertExistingFolder } from '../src/backend/helpers/openFolder';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-open-'));
}

describe('assertExistingFolder', () => {
  it('returns the resolved path for an existing directory', () => {
    const dir = makeTempDir();
    expect(assertExistingFolder(dir)).toBe(path.resolve(dir));
  });

  it('trims surrounding whitespace before resolving', () => {
    const dir = makeTempDir();
    expect(assertExistingFolder(`  ${dir}  `)).toBe(path.resolve(dir));
  });

  it('rejects missing paths', () => {
    const dir = makeTempDir();
    expect(() => assertExistingFolder(path.join(dir, 'missing'))).toThrow();
  });

  it('rejects files', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'video.mkv');
    fs.writeFileSync(file, 'x');
    expect(() => assertExistingFolder(file)).toThrow();
  });

  it('rejects empty paths', () => {
    expect(() => assertExistingFolder('')).toThrow();
    expect(() => assertExistingFolder('   ')).toThrow();
  });
});
