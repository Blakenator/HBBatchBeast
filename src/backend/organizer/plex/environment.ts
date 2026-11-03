import path from 'path';

export type PlexServiceKind =
  | 'systemd'
  | 'launchd'
  | 'windows-process'
  | 'manual';

export interface PlexEnvironmentInput {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  appData: string;
  exists?: (candidate: string) => boolean;
}

export interface PlexEnvironment {
  databaseCandidates: string[];
  serviceKind: PlexServiceKind;
}

const DATABASE_NAME = 'com.plexapp.plugins.library.db';

function platformPath(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function databasePath(platform: NodeJS.Platform, root: string): string {
  return platformPath(platform).join(
    root,
    'Plug-in Support',
    'Databases',
    DATABASE_NAME,
  );
}

/** Candidate Plex database locations for the host platform, best first. */
export function plexDatabaseCandidates(
  input: PlexEnvironmentInput,
): string[] {
  const candidates: string[] = [];
  const join = platformPath(input.platform);
  if (input.platform === 'win32') {
    const localAppData =
      input.env.LOCALAPPDATA ?? join.join(input.appData, '..', 'Local');
    candidates.push(
      databasePath(
        input.platform,
        join.join(localAppData, 'Plex Media Server'),
      ),
      databasePath(
        input.platform,
        join.join(input.appData, 'Plex Media Server'),
      ),
    );
  } else if (input.platform === 'darwin') {
    candidates.push(
      databasePath(
        input.platform,
        join.join(
          input.home,
          'Library',
          'Application Support',
          'Plex Media Server',
        ),
      ),
    );
  } else {
    candidates.push(
      databasePath(
        input.platform,
        '/var/lib/plexmediaserver/Library/Application Support/Plex Media Server',
      ),
      databasePath(
        input.platform,
        join.join(input.home, '.config', 'plex', 'Plex Media Server'),
      ),
    );
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return input.exists ? input.exists(candidate) : true;
  });
}

export function plexServiceHint(platform: NodeJS.Platform): PlexServiceKind {
  if (platform === 'win32') return 'windows-process';
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux') return 'systemd';
  return 'manual';
}

export function plexServiceName(
  platform: NodeJS.Platform,
): string {
  if (platform === 'win32') return 'Plex Media Server.exe';
  if (platform === 'darwin') return 'com.plexapp.plexmediaserver';
  return 'plexmediaserver';
}

export function plexPermissionRemediation(
  platform: NodeJS.Platform,
  databasePath: string,
): string {
  if (platform === 'win32') {
    return `Grant write access to "${databasePath}" with icacls, or run HBBatchBeast as the Windows user that owns the Plex data.`;
  }
  if (platform === 'darwin') {
    return `Ensure HBBatchBeast runs as the macOS user that owns "${databasePath}", or grant write permission in Finder/Get Info.`;
  }
  return `Grant write access to "${databasePath}" (for example, add your user to the "plex" group and sign in again, or use setfacl).`;
}

export function plexServiceInstructions(
  platform: NodeJS.Platform,
): string {
  if (platform === 'win32') {
    return 'Quit Plex Media Server from its tray icon, then click Recheck. HBBatchBeast can also try a graceful close.';
  }
  if (platform === 'darwin') {
    return 'Stop Plex Media Server from its menu bar icon (or launchd), then click Recheck.';
  }
  return 'Run "sudo systemctl stop plexmediaserver" in a terminal, then click Recheck.';
}

export function resolvePlexEnvironment(
  input: PlexEnvironmentInput,
): PlexEnvironment {
  return {
    databaseCandidates: plexDatabaseCandidates(input),
    serviceKind: plexServiceHint(input.platform),
  };
}
