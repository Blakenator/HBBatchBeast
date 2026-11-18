import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegStaticPath from 'ffmpeg-static';
import { expandHomePath } from '../../common/pathUtils';

export interface FfmpegResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** User-configured executable from the global settings. */
  configured?: string;
  exists?: (candidate: string) => boolean;
}

export interface FfmpegStatus {
  available: boolean;
  /** Executable that will be spawned; a bare name when PATH has to resolve it. */
  path: string;
  version?: string;
  source: 'configured' | 'bundled' | 'path';
}

function defaultExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

function isBareName(candidate: string): boolean {
  return !candidate.includes('/') && !candidate.includes('\\');
}

/** Inside an asar the binary has to run from the unpacked copy. */
export function bundledFfmpegPath(): string | undefined {
  if (!ffmpegStaticPath) return undefined;
  return ffmpegStaticPath.replace('app.asar', 'app.asar.unpacked');
}

/**
 * Resolves a configured path against the *target* platform, so a Windows path
 * is interpreted the same way on a Linux CI machine as it would be on Windows.
 * Bare command names are left alone so `PATH` can resolve them.
 */
function configuredCandidate(
  configured: string,
  options: FfmpegResolveOptions,
): string {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const expanded = expandHomePath(configured, home);
  return isBareName(expanded) ? expanded : pathApi(platform).resolve(expanded);
}

/**
 * Executable candidates in priority order: the user's path, the bundled
 * `ffmpeg-static` copy, common installer locations, then the bare command so
 * `PATH` can resolve it.
 */
export function ffmpegExecutableCandidates(
  options: FfmpegResolveOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const api = pathApi(platform);
  const candidates: string[] = [];
  const configured = options.configured?.trim();
  if (configured) {
    candidates.push(configuredCandidate(configured, options));
  }
  const bundled = bundledFfmpegPath();
  if (bundled) candidates.push(bundled);

  if (platform === 'win32') {
    candidates.push('ffmpeg.exe', 'ffmpeg');
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const localAppData =
      env.LOCALAPPDATA ?? api.join(home, 'AppData', 'Local');
    candidates.push(
      api.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
      api.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    );
    return [...new Set(candidates)];
  }

  candidates.push('ffmpeg');
  if (platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/Applications/ffmpeg',
    );
  } else {
    candidates.push(
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/bin/ffmpeg',
      '/snap/bin/ffmpeg',
      '/app/bin/ffmpeg',
    );
  }
  return [...new Set(candidates)];
}

/** First existing absolute candidate, otherwise the platform's bare command. */
export function resolveFfmpegExecutable(
  options: FfmpegResolveOptions = {},
): string {
  const exists = options.exists ?? defaultExists;
  const platform = options.platform ?? process.platform;
  let bareFallback: string | undefined;
  for (const candidate of ffmpegExecutableCandidates(options)) {
    if (isBareName(candidate)) {
      bareFallback ??= candidate;
      continue;
    }
    if (exists(candidate)) return candidate;
  }
  return bareFallback ?? (platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

/** Labels where the executable came from, based on the path that actually won. */
export function ffmpegSourceFor(
  executable: string,
  options: FfmpegResolveOptions = {},
): FfmpegStatus['source'] {
  const configured = options.configured?.trim();
  if (
    configured &&
    executable === configuredCandidate(configured, options)
  ) {
    return 'configured';
  }
  const bundled = bundledFfmpegPath();
  if (bundled && executable === bundled) return 'bundled';
  return 'path';
}

/** Resolves ffmpeg and asks it for its version; never throws. */
export function ffmpegStatus(
  options: FfmpegResolveOptions = {},
): Promise<FfmpegStatus> {
  const executable = resolveFfmpegExecutable(options);
  return new Promise((resolve) => {
    execFile(
      executable,
      ['-hide_banner', '-version'],
      { timeout: 10_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve({
            available: false,
            path: executable,
            source: ffmpegSourceFor(executable, options),
          });
          return;
        }
        const firstLine = String(stdout).split(/\r?\n/, 1)[0]?.trim();
        resolve({
          available: true,
          path: executable,
          ...(firstLine ? { version: firstLine } : {}),
          source: ffmpegSourceFor(executable, options),
        });
      },
    );
  });
}
