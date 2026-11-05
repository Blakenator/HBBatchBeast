import fs from 'fs';
import path from 'path';
import type {
  PlexFixStep,
  PlexIssue,
  PlexRemediation,
  PlexRemediationStep,
  PlexServiceKind,
} from '../../../common/organizer/types';
import {
  canElevate,
  runElevated,
  type ElevationRequest,
  type ElevationResult,
} from './elevation';
import {
  plexExecutableCandidates,
  plexServiceName,
} from './environment';
import {
  defaultRunner,
  startPlexService,
  stopPlexService,
  waitForPlexStopped,
  type CommandRunner,
} from './service';

export interface PlexRemediationInput {
  platform: NodeJS.Platform;
  dbPath: string;
  user: string;
  exists: boolean;
  writable: boolean;
  /** Whether the folder holding the database accepts new files. */
  folderWritable?: boolean;
  running: boolean;
  serviceKind: PlexServiceKind;
  /** Resolved Plex executable, used by the Windows start command. */
  executable?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  existsOnDisk?: (candidate: string) => boolean;
}

export interface PlexAutoFixInput extends PlexRemediationInput {
  run?: CommandRunner;
  /** Test seam for the elevated step. */
  elevate?: (request: ElevationRequest) => Promise<ElevationResult>;
}

function platformPath(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Folder that holds the database plus its -wal/-shm/journal sidecars. */
export function plexDatabaseFolder(
  platform: NodeJS.Platform,
  dbPath: string,
): string {
  return platformPath(platform).dirname(dbPath);
}

export interface PlexAccessState {
  fileWritable: boolean;
  folderWritable: boolean;
  /** SQLite needs the database and its journal folder to be writable. */
  writable: boolean;
}

function defaultWritable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Plex keeps its database in WAL mode, so opening it read-write creates
 * `-wal`/`-shm` files next to it. Writing the database file alone is not
 * enough: the folder must be writable too.
 */
export function plexAccessState(
  platform: NodeJS.Platform,
  dbPath: string,
  writable: (target: string) => boolean = defaultWritable,
): PlexAccessState {
  const fileWritable = writable(dbPath);
  const folderWritable = writable(plexDatabaseFolder(platform, dbPath));
  return {
    fileWritable,
    folderWritable,
    writable: fileWritable && folderWritable,
  };
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolvedExecutable(input: PlexRemediationInput): string | undefined {
  if (input.executable) return input.executable;
  const candidates = plexExecutableCandidates({
    platform: input.platform,
    env: input.env ?? process.env,
    home: input.home ?? '',
    ...(input.existsOnDisk ? { exists: input.existsOnDisk } : {}),
  });
  return candidates[0];
}

function stopCommand(input: PlexRemediationInput): string {
  const service = plexServiceName(input.platform);
  if (input.platform === 'linux') {
    return `sudo systemctl stop ${service}`;
  }
  if (input.platform === 'darwin') {
    return `launchctl stop ${service}`;
  }
  if (input.platform === 'win32') {
    return `taskkill /IM "${service}" /F`;
  }
  return '';
}

function startCommand(input: PlexRemediationInput): string {
  const service = plexServiceName(input.platform);
  if (input.platform === 'linux') {
    return `sudo systemctl start ${service}`;
  }
  if (input.platform === 'darwin') {
    return `launchctl start ${service}`;
  }
  if (input.platform === 'win32') {
    const executable =
      resolvedExecutable(input) ??
      '%ProgramFiles%\\Plex\\Plex Media Server\\Plex Media Server.exe';
    return `cmd /c start "" "${executable}"`;
  }
  return '';
}

function grantCommands(
  input: PlexRemediationInput,
  elevated: boolean,
): string[] {
  const folder = quotePosix(plexDatabaseFolder(input.platform, input.dbPath));
  const prefix = elevated ? '' : 'sudo ';
  if (input.platform === 'linux') {
    const directoryAcl = quotePosix(
      `u:${input.user}:rwx,d:u:${input.user}:rwx`,
    );
    const fileAcl = quotePosix(`u:${input.user}:rwx`);
    return [
      `${prefix}find ${folder} -type d -exec setfacl -m ${directoryAcl} {} +`,
      `${prefix}find ${folder} -type f -exec setfacl -m ${fileAcl} {} +`,
    ];
  }
  if (input.platform === 'darwin') {
    const directoryAcl = quotePosix(
      `${input.user} allow read,write,delete,add_file,add_subdirectory,file_inherit,directory_inherit`,
    );
    const fileAcl = quotePosix(`${input.user} allow read,write`);
    return [
      `${prefix}find ${folder} -type d -exec chmod +a ${directoryAcl} {} +`,
      `${prefix}find ${folder} -type f -exec chmod +a ${fileAcl} {} +`,
    ];
  }
  if (input.platform === 'win32') {
    const folderValue = path.win32.dirname(input.dbPath);
    return [`icacls "${folderValue}" /grant "${input.user}:(OI)(CI)F" /T`];
  }
  return [];
}

function grantCommand(input: PlexRemediationInput): string {
  return grantCommands(input, false).join('\n');
}

export function plexRemediation(
  input: PlexRemediationInput,
): PlexRemediation {
  const needsGrant = input.exists && !input.writable;
  const steps: PlexRemediationStep[] = [];
  if (input.running) {
    const command = stopCommand(input);
    if (command) {
      steps.push({
        id: 'stop-service',
        title: 'Stop Plex Media Server',
        command,
      });
    }
  }
  if (needsGrant) {
    const command = grantCommand(input);
    if (command) {
      steps.push({
        id: 'grant-access',
        title: 'Grant your user access to the Plex database',
        command,
      });
    }
  }
  if (input.running && needsGrant) {
    const command = startCommand(input);
    if (command) {
      steps.push({
        id: 'start-service',
        title: 'Start Plex Media Server',
        command,
      });
    }
  }
  const hasStop = steps.some((step) => step.id === 'stop-service');
  const hasGrant = steps.some((step) => step.id === 'grant-access');
  const summary = !input.exists
    ? 'Choose the Plex database before running a fix.'
    : hasStop && hasGrant
      ? `Stop Plex, grant "${input.user}" write access to the database folder, then start Plex again.`
      : hasGrant
        ? `Grant "${input.user}" write access to the Plex database folder.`
        : hasStop
          ? 'Plex must be stopped before HBBatchBeast can update the database.'
          : 'No manual steps are needed.';

  return {
    summary,
    steps,
    script: steps.map((step) => step.command).join('\n'),
  };
}

export function plexIssues(input: PlexRemediationInput): PlexIssue[] {
  const issues: PlexIssue[] = [];
  if (!input.exists) {
    issues.push({
      id: 'database-missing',
      severity: 'error',
      title: 'Plex database not found',
      detail: `No database exists at ${input.dbPath}. Choose Plex's Plug-in Support/Databases/com.plexapp.plugins.library.db file.`,
      fixable: false,
    });
  } else if (input.folderWritable === false) {
    issues.push({
      id: 'database-folder-not-writable',
      severity: 'error',
      title: 'Plex database folder is read-only',
      detail: `HBBatchBeast cannot create SQLite journal files in ${plexDatabaseFolder(input.platform, input.dbPath)}. Grant "${input.user}" write access to that folder; Plex keeps ownership of the files.`,
      fixable: canAutoFixPlex(input),
    });
  } else if (!input.writable) {
    issues.push({
      id: 'database-not-writable',
      severity: 'error',
      title: 'Plex database is read-only',
      detail: `HBBatchBeast cannot write to the Plex database. Grant "${input.user}" access to the Databases folder; Plex keeps ownership of the files.`,
      fixable: canAutoFixPlex(input),
    });
  }
  if (input.running) {
    issues.push({
      id: 'service-running',
      severity: 'warning',
      title: 'Plex Media Server is running',
      detail:
        'Stop Plex before updating the database. HBBatchBeast restarts it after the update.',
      fixable: false,
    });
  }
  if (input.serviceKind === 'manual') {
    issues.push({
      id: 'service-unknown',
      severity: 'info',
      title: 'Plex service was not detected',
      detail:
        'Stop Plex from its tray icon or process list, then check the database again.',
      fixable: false,
    });
  }
  return issues;
}

export function canAutoFixPlex(input: PlexRemediationInput): boolean {
  return (
    input.exists &&
    !input.writable &&
    canElevate(
      input.platform,
      input.env ?? process.env,
      input.existsOnDisk ?? fs.existsSync,
    )
  );
}

export function plexElevationRequest(
  input: PlexRemediationInput,
): ElevationRequest | undefined {
  if (!input.exists || input.writable) return undefined;
  if (input.platform === 'linux' || input.platform === 'darwin') {
    const script = grantCommands(input, true).join(' && ');
    return script ? { posixScript: script } : undefined;
  }
  if (input.platform === 'win32') {
    const folder = path.win32.dirname(input.dbPath);
    return {
      windows: {
        file: 'icacls.exe',
        args: [folder, '/grant', `${input.user}:(OI)(CI)F`, '/T'],
      },
    };
  }
  return undefined;
}

/**
 * Best-effort fix: stop Plex, grant the current user ACL access (Plex keeps
 * ownership), then start Plex again only when the fix stopped it.
 */
export async function attemptPlexAutoFix(
  input: PlexAutoFixInput,
): Promise<PlexFixStep[]> {
  const run = input.run ?? defaultRunner;
  const steps: PlexFixStep[] = [];
  let stopped = false;

  const elevate = (request: ElevationRequest): Promise<ElevationResult> =>
    input.elevate
      ? input.elevate(request)
      : runElevated(
          input.platform,
          request,
          run,
          input.env ?? process.env,
          input.existsOnDisk ?? fs.existsSync,
        );

  const recordStop = async (detail?: string): Promise<void> => {
    if (!detail) {
      const status = await waitForPlexStopped(input.platform, 15_000, run);
      stopped = !status.running;
      steps.push({
        id: 'stop-service',
        title: 'Stop Plex Media Server',
        ok: stopped,
        ...(stopped
          ? {}
          : { detail: 'Plex did not stop within 15 seconds.' }),
      });
      return;
    }
    steps.push({
      id: 'stop-service',
      title: 'Stop Plex Media Server',
      ok: false,
      detail,
    });
  };

  if (input.running) {
    const stop = await stopPlexService(input.platform, run);
    if (stop.ok) {
      await recordStop();
    } else if (input.platform === 'linux') {
      const elevated = await elevate({
        posixScript: `systemctl stop ${plexServiceName('linux')}`,
      });
      await recordStop(elevated.ok ? undefined : stop.message);
    } else {
      await recordStop(stop.message);
    }
  }

  if (input.exists && !input.writable) {
    const request = plexElevationRequest(input);
    if (!request) {
      steps.push({
        id: 'grant-access',
        title: 'Grant your user access to the Plex database',
        ok: false,
        detail: 'This platform has no supported elevation helper.',
      });
    } else {
      const result = await elevate(request);
      steps.push({
        id: 'grant-access',
        title: 'Grant your user access to the Plex database',
        ok: result.ok,
        ...(result.ok
          ? {}
          : {
              detail:
                result.detail ||
                'The administrator prompt was cancelled or failed.',
            }),
      });
    }
  }

  if (stopped) {
    const start = await startPlexService(
      input.platform,
      run,
      input.executable,
    );
    if (start.ok) {
      steps.push({
        id: 'start-service',
        title: 'Start Plex Media Server',
        ok: true,
      });
    } else if (input.platform === 'linux') {
      const elevated = await elevate({
        posixScript: `systemctl start ${plexServiceName('linux')}`,
      });
      steps.push({
        id: 'start-service',
        title: 'Start Plex Media Server',
        ok: elevated.ok,
        ...(elevated.ok
          ? {}
          : { detail: elevated.detail || start.message }),
      });
    } else {
      steps.push({
        id: 'start-service',
        title: 'Start Plex Media Server',
        ok: false,
        detail: start.message,
      });
    }
  }

  return steps;
}
