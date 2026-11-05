import path from 'path';
import type { PlexServiceKind } from '../../../common/organizer/types';

export type { PlexServiceKind };

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

export interface PlexExecutableInput {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists?: (candidate: string) => boolean;
}

/** Places a platform keeps the Plex Media Server executable, best first. */
export function plexExecutableCandidates(
  input: PlexExecutableInput,
): string[] {
  const join = platformPath(input.platform);
  const candidates: string[] = [];
  if (input.platform === 'win32') {
    const programFiles = input.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = input.env['ProgramFiles(x86)'];
    const localAppData = input.env.LOCALAPPDATA;
    candidates.push(
      join.join(
        programFiles,
        'Plex',
        'Plex Media Server',
        'Plex Media Server.exe',
      ),
    );
    if (programFilesX86) {
      candidates.push(
        join.join(
          programFilesX86,
          'Plex',
          'Plex Media Server',
          'Plex Media Server.exe',
        ),
      );
    }
    if (localAppData) {
      candidates.push(
        join.join(
          localAppData,
          'Plex',
          'Plex Media Server',
          'Plex Media Server.exe',
        ),
        join.join(
          localAppData,
          'Programs',
          'Plex',
          'Plex Media Server',
          'Plex Media Server.exe',
        ),
      );
    }
  } else if (input.platform === 'darwin') {
    candidates.push(
      '/Applications/Plex Media Server.app/Contents/MacOS/Plex Media Server',
      join.join(
        input.home,
        'Applications',
        'Plex Media Server.app',
        'Contents',
        'MacOS',
        'Plex Media Server',
      ),
    );
  } else {
    candidates.push(
      '/usr/lib/plexmediaserver/Plex Media Server',
      '/opt/plexmediaserver/Plex Media Server',
    );
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return input.exists ? input.exists(candidate) : true;
  });
}

export function plexStartInstructions(
  platform: NodeJS.Platform,
  executable?: string,
): string {
  if (platform === 'win32') {
    const target =
      executable ??
      '%ProgramFiles%\\Plex\\Plex Media Server\\Plex Media Server.exe';
    return `Run 'cmd /c start "" "${target}"' in a terminal, or start Plex from the Start menu.`;
  }
  if (platform === 'darwin') {
    return 'Run "launchctl start com.plexapp.plexmediaserver" in Terminal, or start Plex from its menu bar icon.';
  }
  if (platform === 'linux') {
    return 'Run "sudo systemctl start plexmediaserver" in a terminal.';
  }
  return 'Start Plex Media Server manually.';
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
