import fs from 'fs';
import path from 'path';
import type { CommandRunner } from './service';

export interface ElevationRequest {
  /** POSIX shell script used by pkexec (Linux) and osascript (macOS). */
  posixScript?: string;
  /** Program and arguments used with a Windows UAC prompt. */
  windows?: { file: string; args: string[] };
}

export interface ElevationResult {
  ok: boolean;
  detail: string;
}

const ELEVATION_TIMEOUT_MS = 120_000;

function platformPath(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Looks up a program on PATH for a platform that may differ from the host. */
export function findOnPath(
  platform: NodeJS.Platform,
  program: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): string | undefined {
  const join = platformPath(platform);
  const pathValue =
    platform === 'win32'
      ? (env.Path ?? env.PATH ?? '')
      : (env.PATH ?? env.Path ?? '');
  const separator = platform === 'win32' ? ';' : ':';
  const extensions =
    platform === 'win32' && !path.win32.extname(program)
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  for (const directory of pathValue.split(separator)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join.join(directory, `${program}${extension}`);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Absolute helper locations, used when an app starts with a minimal PATH. */
export function elevationHelperPath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): string | undefined {
  if (platform === 'linux') {
    return (
      findOnPath(platform, 'pkexec', env, exists) ??
      ['/usr/bin/pkexec', '/usr/local/bin/pkexec'].find(exists)
    );
  }
  if (platform === 'darwin') {
    return (
      findOnPath(platform, 'osascript', env, exists) ??
      (exists('/usr/bin/osascript') ? '/usr/bin/osascript' : undefined)
    );
  }
  if (platform === 'win32') {
    const fromPath = findOnPath(platform, 'powershell.exe', env, exists);
    if (fromPath) return fromPath;
    const systemRoot = env.SystemRoot ?? 'C:\\Windows';
    const candidate = path.win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    return exists(candidate) ? candidate : undefined;
  }
  return undefined;
}

/** True when the platform has a native elevation helper we can invoke. */
export function canElevate(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): boolean {
  return Boolean(elevationHelperPath(platform, env, exists));
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function windowsArgumentString(args: string[]): string {
  return args
    .map((argument) =>
      /[\s"]/.test(argument) || argument.length === 0
        ? `"${argument.replace(/"/g, '""')}"`
        : argument,
    )
    .join(' ');
}

/**
 * Runs a privileged Plex fix through the platform's native elevation prompt.
 * Never throws: a denied or unavailable prompt returns `ok: false` so the UI
 * can show the manual commands instead.
 */
export async function runElevated(
  platform: NodeJS.Platform,
  request: ElevationRequest,
  run: CommandRunner,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): Promise<ElevationResult> {
  try {
    if (platform === 'linux') {
      if (!request.posixScript) {
        return { ok: false, detail: 'No privileged command was provided.' };
      }
      const pkexec = elevationHelperPath(platform, env, exists);
      if (!pkexec) {
        return {
          ok: false,
          detail: 'pkexec is not installed, so the fix cannot be elevated.',
        };
      }
      const result = await run(
        pkexec,
        ['/bin/sh', '-c', request.posixScript],
        { timeoutMs: ELEVATION_TIMEOUT_MS },
      );
      return {
        ok: result.code === 0,
        detail: (result.stderr || result.stdout).trim(),
      };
    }
    if (platform === 'darwin') {
      if (!request.posixScript) {
        return { ok: false, detail: 'No privileged command was provided.' };
      }
      const osascript = elevationHelperPath(platform, env, exists);
      if (!osascript) {
        return {
          ok: false,
          detail: 'osascript is unavailable, so the fix cannot be elevated.',
        };
      }
      const script = `do shell script "${escapeAppleScript(
        request.posixScript,
      )}" with administrator privileges`;
      const result = await run(osascript, ['-e', script], {
        timeoutMs: ELEVATION_TIMEOUT_MS,
      });
      return {
        ok: result.code === 0,
        detail: (result.stderr || result.stdout).trim(),
      };
    }
    if (platform === 'win32') {
      if (!request.windows) {
        return { ok: false, detail: 'No privileged command was provided.' };
      }
      const powershell = elevationHelperPath(platform, env, exists);
      if (!powershell) {
        return {
          ok: false,
          detail: 'PowerShell is unavailable, so the fix cannot be elevated.',
        };
      }
      const argumentsString = windowsArgumentString(request.windows.args);
      const script = [
        `$process = Start-Process -FilePath ${psQuote(
          request.windows.file,
        )} -ArgumentList ${psQuote(argumentsString)} -Verb RunAs -PassThru -Wait`,
        'exit $process.ExitCode',
      ].join('; ');
      const result = await run(
        powershell,
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeoutMs: ELEVATION_TIMEOUT_MS },
      );
      return {
        ok: result.code === 0,
        detail: (result.stderr || result.stdout).trim(),
      };
    }
    return {
      ok: false,
      detail: 'This platform has no supported elevation helper.',
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
