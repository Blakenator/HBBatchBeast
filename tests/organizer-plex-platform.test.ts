import { describe, expect, it } from 'vitest';
import {
  plexDatabaseCandidates,
  plexServiceHint,
  plexServiceInstructions,
  plexServiceName,
  plexStartInstructions,
  resolvePlexEnvironment,
} from '../src/backend/organizer/plex/environment';
import {
  detectPlexService,
  startPlexService,
  stopPlexService,
  waitForPlexStopped,
  type CommandResult,
} from '../src/backend/organizer/plex/service';

const dbName = 'com.plexapp.plugins.library.db';

function runner(responses: Record<string, Partial<CommandResult>>) {
  const calls: { file: string; args: string[] }[] = [];
  const run = async (file: string, args: string[]): Promise<CommandResult> => {
    calls.push({ file, args });
    const response = responses[`${file} ${args.join(' ')}`] ?? {};
    return {
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      code: response.code ?? 0,
    };
  };
  return { run, calls };
}

describe('Plex environment', () => {
  it('uses systemd and Linux paths, keeping only databases that exist', () => {
    const expected = `/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases/${dbName}`;
    const candidates = plexDatabaseCandidates({
      platform: 'linux',
      env: {},
      home: '/home/ada',
      appData: '/home/ada/.config',
      exists: (candidate) => candidate === expected,
    });
    expect(candidates).toEqual([expected]);
    expect(plexServiceHint('linux')).toBe('systemd');
    expect(plexServiceName('linux')).toBe('plexmediaserver');
    expect(resolvePlexEnvironment({
      platform: 'linux',
      env: {},
      home: '/home/ada',
      appData: '/home/ada/.config',
    }).serviceKind).toBe('systemd');
  });

  it('uses launchd and Application Support on macOS', () => {
    const candidates = plexDatabaseCandidates({
      platform: 'darwin',
      env: {},
      home: '/Users/ada',
      appData: '/Users/ada/Library/Application Support',
    });
    expect(candidates).toEqual([
      `/Users/ada/Library/Application Support/Plex Media Server/Plug-in Support/Databases/${dbName}`,
    ]);
    expect(plexServiceHint('darwin')).toBe('launchd');
    expect(plexServiceName('darwin')).toBe('com.plexapp.plexmediaserver');
  });

  it('uses LOCALAPPDATA and backslashes on Windows', () => {
    const candidates = plexDatabaseCandidates({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
      home: 'C:\\Users\\Ada',
      appData: 'C:\\Users\\Ada\\AppData\\Roaming',
    });
    expect(candidates[0]).toBe(
      `C:\\Users\\Ada\\AppData\\Local\\Plex Media Server\\Plug-in Support\\Databases\\${dbName}`,
    );
    expect(candidates[0]).not.toContain('/');
    expect(plexServiceHint('win32')).toBe('windows-process');
    expect(plexServiceName('win32')).toBe('Plex Media Server.exe');
  });

  it('falls back to manual guidance on unknown platforms', () => {
    expect(plexServiceHint('freebsd')).toBe('manual');
    expect(resolvePlexEnvironment({
      platform: 'freebsd',
      env: {},
      home: '/home/ada',
      appData: '/home/ada/.config',
    }).databaseCandidates).toHaveLength(2);
  });

  it('gives OS-specific service instructions', () => {
    expect(plexServiceInstructions('linux')).toContain('systemctl stop');
    expect(plexServiceInstructions('darwin')).toContain('launchd');
    expect(plexServiceInstructions('win32')).toContain('tray');
    expect(plexStartInstructions('linux')).toContain('systemctl start');
    expect(plexStartInstructions('darwin')).toContain('launchctl start');
    expect(plexStartInstructions('win32', 'C:\\Plex\\Plex.exe')).toContain(
      'C:\\Plex\\Plex.exe',
    );
  });
});

describe('Plex service control', () => {
  it('detects an active systemd unit', async () => {
    const fake = runner({ 'systemctl is-active plexmediaserver': { stdout: 'active\n' } });
    await expect(detectPlexService('linux', fake.run)).resolves.toEqual({
      kind: 'systemd',
      running: true,
      detail: 'active',
    });
  });

  it('detects launchd jobs and falls back to pgrep', async () => {
    const found = runner({
      'launchctl list': { stdout: 'com.plexapp.plexmediaserver\n' },
    });
    await expect(detectPlexService('darwin', found.run)).resolves.toMatchObject({
      kind: 'launchd',
      running: true,
    });

    const fallback = runner({
      'launchctl list': { stdout: 'no jobs\n' },
      'pgrep -f Plex Media Server': { stdout: '4242\n' },
    });
    await expect(detectPlexService('darwin', fallback.run)).resolves.toMatchObject({
      kind: 'manual',
      running: true,
      detail: '4242',
    });
  });

  it('detects the Windows process with tasklist', async () => {
    const fake = runner({
      'tasklist /FI IMAGENAME eq Plex Media Server.exe': {
        stdout: 'Plex Media Server.exe   4242 Console',
      },
    });
    await expect(detectPlexService('win32', fake.run)).resolves.toMatchObject({
      kind: 'windows-process',
      running: true,
    });
  });

  it('stops Plex with the platform service manager', async () => {
    const linux = runner({ 'systemctl stop plexmediaserver': {} });
    await expect(stopPlexService('linux', linux.run)).resolves.toMatchObject({
      ok: true,
    });
    expect(linux.calls).toEqual([
      { file: 'systemctl', args: ['stop', 'plexmediaserver'] },
    ]);

    const mac = runner({ 'launchctl stop com.plexapp.plexmediaserver': {} });
    await expect(stopPlexService('darwin', mac.run)).resolves.toMatchObject({
      ok: true,
    });
    expect(mac.calls[0]).toEqual({
      file: 'launchctl',
      args: ['stop', 'com.plexapp.plexmediaserver'],
    });

    const windows = runner({ 'taskkill /IM Plex Media Server.exe': {} });
    await expect(stopPlexService('win32', windows.run)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('returns manual instructions when a stop fails', async () => {
    const fake = runner({
      'systemctl stop plexmediaserver': { code: 1, stderr: 'denied' },
    });
    await expect(stopPlexService('linux', fake.run)).resolves.toEqual({
      ok: false,
      message: plexServiceInstructions('linux'),
    });
  });

  it('starts Plex with systemd or launchd', async () => {
    const linux = runner({ 'systemctl start plexmediaserver': {} });
    await expect(startPlexService('linux', linux.run)).resolves.toMatchObject({
      ok: true,
    });

    const mac = runner({ 'launchctl start com.plexapp.plexmediaserver': {} });
    await expect(startPlexService('darwin', mac.run)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('waits for Plex to stop', async () => {
    const fake = runner({ 'systemctl is-active plexmediaserver': { stdout: 'inactive\n' } });
    await expect(
      waitForPlexStopped('linux', 1000, fake.run),
    ).resolves.toMatchObject({ running: false });
  });
});
