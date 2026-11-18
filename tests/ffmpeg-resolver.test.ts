import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  bundledFfmpegPath,
  ffmpegExecutableCandidates,
  ffmpegSourceFor,
  resolveFfmpegExecutable,
} from '../src/backend/helpers/ffmpeg';

describe('ffmpeg resolver', () => {
  it('prefers an existing configured path on POSIX and Windows', () => {
    expect(
      resolveFfmpegExecutable({
        platform: 'linux',
        configured: '/opt/ffmpeg/bin/ffmpeg',
        exists: (candidate) => candidate === '/opt/ffmpeg/bin/ffmpeg',
      }),
    ).toBe('/opt/ffmpeg/bin/ffmpeg');

    expect(
      resolveFfmpegExecutable({
        platform: 'win32',
        configured: 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe',
        exists: (candidate) =>
          candidate === 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe',
      }),
    ).toBe('C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe');
  });

  it('expands a leading tilde before resolving the configured path', () => {
    const home = '/home/tester';
    const seen: string[] = [];
    resolveFfmpegExecutable({
      platform: 'linux',
      home,
      configured: '~/bin/ffmpeg',
      exists: (candidate) => {
        seen.push(candidate);
        return candidate === path.posix.join(home, 'bin', 'ffmpeg');
      },
    });
    expect(seen[0]).toBe(path.posix.join(home, 'bin', 'ffmpeg'));
  });

  it('normalizes mixed separators and drive letters for Windows', () => {
    const mixed = ffmpegExecutableCandidates({
      platform: 'win32',
      configured: 'C:/Tools/ffmpeg/bin/ffmpeg.exe',
      env: {},
    });
    expect(mixed[0]).toBe('C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe');

    const unc = resolveFfmpegExecutable({
      platform: 'win32',
      configured: '\\\\server\\share\\ffmpeg.exe',
      exists: (candidate) => candidate === '\\\\server\\share\\ffmpeg.exe',
    });
    expect(unc).toBe('\\\\server\\share\\ffmpeg.exe');
  });

  it('falls back to the platform bare command when nothing exists', () => {
    expect(
      resolveFfmpegExecutable({
        platform: 'linux',
        exists: () => false,
      }),
    ).toBe('ffmpeg');
    expect(
      resolveFfmpegExecutable({
        platform: 'win32',
        exists: () => false,
      }),
    ).toBe('ffmpeg.exe');
  });

  it('keeps a configured bare command for PATH to resolve', () => {
    expect(
      resolveFfmpegExecutable({
        platform: 'linux',
        configured: 'ffmpeg-nightly',
        exists: () => false,
      }),
    ).toBe('ffmpeg-nightly');
  });

  it('includes the bundled binary and per-platform install locations', () => {
    const bundled = bundledFfmpegPath();
    const linux = ffmpegExecutableCandidates({ platform: 'linux' });
    expect(linux).toContain('/usr/bin/ffmpeg');
    if (bundled) expect(linux).toContain(bundled);

    const mac = ffmpegExecutableCandidates({ platform: 'darwin' });
    expect(mac).toContain('/opt/homebrew/bin/ffmpeg');

    const win = ffmpegExecutableCandidates({ platform: 'win32', env: {} });
    expect(win).toContain('ffmpeg.exe');
    expect(
      win.some((candidate) =>
        candidate.startsWith('C:\\Program Files\\ffmpeg\\'),
      ),
    ).toBe(true);
  });

  it('labels the source from the path that actually won', () => {
    expect(
      ffmpegSourceFor('/opt/ffmpeg/bin/ffmpeg', {
        configured: '/opt/ffmpeg/bin/ffmpeg',
      }),
    ).toBe('configured');
    // A configured path that did not resolve must not claim to be in use.
    expect(
      ffmpegSourceFor('/usr/bin/ffmpeg', {
        configured: '/missing/ffmpeg',
        home: '/home/tester',
      }),
    ).toBe('path');
    const bundled = bundledFfmpegPath();
    if (bundled) expect(ffmpegSourceFor(bundled, {})).toBe('bundled');
  });
});
