import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const icons = fileURLToPath(new URL('../src/assets/icons/', import.meta.url));

function read(relativePath: string): Buffer {
  return fs.readFileSync(path.join(icons, relativePath));
}

function pngSize(relativePath: string): { width: number; height: number } {
  const buffer = read(relativePath);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('icon assets', () => {
  it('ships the app icon at 1024px and every tray state at 64px', () => {
    expect(pngSize('png/icon.png')).toEqual({ width: 1024, height: 1024 });
    for (const name of ['tray', 'iconrunning', 'iconwatching', 'iconerror']) {
      expect(pngSize(`png/${name}.png`)).toEqual({ width: 64, height: 64 });
    }
  });

  it('packs multi-size Windows and macOS app icons', () => {
    const ico = read('win/icon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);

    const icns = read('mac/icon.icns');
    expect(icns.subarray(0, 4).toString()).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});
