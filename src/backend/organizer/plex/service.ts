import { execFile, spawn } from 'child_process';
import {
  plexServiceInstructions,
  plexServiceName,
  plexServiceHint,
  type PlexServiceKind,
} from './environment';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<CommandResult>;

export interface PlexServiceStatus {
  kind: PlexServiceKind;
  running: boolean;
  detail?: string;
}

const defaultRunner: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? error?.message ?? ''),
          code:
            typeof (error as { code?: unknown } | null)?.code === 'number'
              ? ((error as { code: number }).code)
              : error
                ? 1
                : 0,
        });
      },
    );
  });

export async function detectPlexService(
  platform: NodeJS.Platform,
  run: CommandRunner = defaultRunner,
): Promise<PlexServiceStatus> {
  const kind = plexServiceHint(platform);
  try {
    if (platform === 'win32') {
      const result = await run('tasklist', [
        '/FI',
        `IMAGENAME eq ${plexServiceName(platform)}`,
      ]);
      const running = result.stdout
        .toLowerCase()
        .includes(plexServiceName(platform).toLowerCase());
      return { kind, running, detail: result.stdout.trim() };
    }
    if (platform === 'darwin') {
      const result = await run('launchctl', ['list']);
      const label = plexServiceName(platform);
      const running = result.stdout.includes(label);
      if (running) return { kind, running, detail: label };
      const fallback = await run('pgrep', ['-f', 'Plex Media Server']);
      return {
        kind: 'manual',
        running: fallback.code === 0 && fallback.stdout.trim().length > 0,
        detail: fallback.stdout.trim(),
      };
    }
    if (platform === 'linux') {
      const result = await run('systemctl', [
        'is-active',
        plexServiceName(platform),
      ]);
      return {
        kind,
        running: result.stdout.trim() === 'active',
        detail: result.stdout.trim(),
      };
    }
  } catch (error) {
    return {
      kind: 'manual',
      running: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  return { kind: 'manual', running: false };
}

export interface PlexServiceAction {
  ok: boolean;
  message: string;
}

/** Best-effort stop. Permission failures return instructions, never throw. */
export async function stopPlexService(
  platform: NodeJS.Platform,
  run: CommandRunner = defaultRunner,
): Promise<PlexServiceAction> {
  if (platform === 'linux') {
    const result = await run('systemctl', ['stop', plexServiceName(platform)]);
    return result.code === 0
      ? { ok: true, message: 'Plex Media Server stopped.' }
      : { ok: false, message: plexServiceInstructions(platform) };
  }
  if (platform === 'win32') {
    const result = await run('taskkill', ['/IM', plexServiceName(platform)]);
    return result.code === 0
      ? { ok: true, message: 'Plex Media Server closed.' }
      : { ok: false, message: plexServiceInstructions(platform) };
  }
  if (platform === 'darwin') {
    const result = await run('launchctl', [
      'stop',
      plexServiceName(platform),
    ]);
    return result.code === 0
      ? { ok: true, message: 'Plex Media Server stopped.' }
      : { ok: false, message: plexServiceInstructions(platform) };
  }
  return { ok: false, message: plexServiceInstructions(platform) };
}

/** Best-effort restart after a successful update. */
export async function startPlexService(
  platform: NodeJS.Platform,
  run: CommandRunner = defaultRunner,
  windowsExecutable?: string,
): Promise<PlexServiceAction> {
  if (platform === 'linux') {
    const result = await run('systemctl', ['start', plexServiceName(platform)]);
    return result.code === 0
      ? { ok: true, message: 'Plex Media Server started.' }
      : { ok: false, message: plexServiceInstructions(platform) };
  }
  if (platform === 'darwin') {
    const result = await run('launchctl', [
      'start',
      plexServiceName(platform),
    ]);
    return result.code === 0
      ? { ok: true, message: 'Plex Media Server started.' }
      : { ok: false, message: plexServiceInstructions(platform) };
  }
  if (platform === 'win32' && windowsExecutable) {
    try {
      const child = spawn(windowsExecutable, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { ok: true, message: 'Plex Media Server started.' };
    } catch {
      return { ok: false, message: plexServiceInstructions(platform) };
    }
  }
  return { ok: false, message: plexServiceInstructions(platform) };
}

export async function waitForPlexStopped(
  platform: NodeJS.Platform,
  timeoutMs = 15_000,
  run: CommandRunner = defaultRunner,
): Promise<PlexServiceStatus> {
  const deadline = Date.now() + timeoutMs;
  let last = await detectPlexService(platform, run);
  while (last.running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    last = await detectPlexService(platform, run);
  }
  return last;
}
