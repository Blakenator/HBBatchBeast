import { describe, expect, it, vi } from 'vitest';
import {
  attemptPlexAutoFix,
  canAutoFixPlex,
  plexAccessState,
  plexDatabaseFolder,
  plexElevationRequest,
  plexIssues,
  plexRemediation,
  type PlexRemediationInput,
} from '../src/backend/organizer/plex/remediation';
import {
  canElevate,
  findOnPath,
  runElevated,
} from '../src/backend/organizer/plex/elevation';
import type {
  CommandResult,
  CommandRunner,
} from '../src/backend/organizer/plex/service';

const linuxDb =
  '/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db';
const linuxFolder =
  '/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases';
const macDb =
  '/Users/ada/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db';
const macFolder =
  '/Users/ada/Library/Application Support/Plex Media Server/Plug-in Support/Databases';
const windowsDb =
  'C:\\Users\\Ada\\AppData\\Local\\Plex Media Server\\Plug-in Support\\Databases\\com.plexapp.plugins.library.db';
const windowsFolder =
  'C:\\Users\\Ada\\AppData\\Local\\Plex Media Server\\Plug-in Support\\Databases';

function input(patch: Partial<PlexRemediationInput> = {}): PlexRemediationInput {
  return {
    platform: 'linux',
    dbPath: linuxDb,
    user: 'ada',
    exists: true,
    writable: false,
    running: true,
    serviceKind: 'systemd',
    home: '/home/ada',
    env: { PATH: '/usr/bin:/bin' },
    existsOnDisk: () => true,
    ...patch,
  };
}

function runner(responses: Record<string, Partial<CommandResult>>) {
  const calls: { file: string; args: string[] }[] = [];
  const run: CommandRunner = async (file, args) => {
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

describe('Plex remediation commands', () => {
  it('uses the database folder and quotes paths', () => {
    expect(plexDatabaseFolder('linux', linuxDb)).toBe(linuxFolder);
    expect(plexDatabaseFolder('win32', windowsDb)).toBe(windowsFolder);
  });

  it('builds the full Linux stop, setfacl and start sequence', () => {
    const remediation = plexRemediation(input());
    expect(remediation.steps.map((step) => step.id)).toEqual([
      'stop-service',
      'grant-access',
      'start-service',
    ]);
    expect(remediation.script).toContain('sudo systemctl stop plexmediaserver');
    expect(remediation.script).toContain(
      `sudo find '${linuxFolder}' -type d -exec setfacl -m 'u:ada:rwx,d:u:ada:rwx' {} +`,
    );
    expect(remediation.script).toContain(
      `sudo find '${linuxFolder}' -type f -exec setfacl -m 'u:ada:rwx' {} +`,
    );
    expect(remediation.script).toContain(
      'sudo systemctl start plexmediaserver',
    );
    expect(remediation.summary).toContain('Stop Plex');
  });

  it('builds macOS launchd and chmod ACL commands', () => {
    const remediation = plexRemediation(
      input({
        platform: 'darwin',
        serviceKind: 'launchd',
        dbPath: macDb,
        home: '/Users/ada',
      }),
    );
    expect(remediation.script).toContain(
      'launchctl stop com.plexapp.plexmediaserver',
    );
    expect(remediation.script).toContain(
      `sudo find '${macFolder}' -type d -exec chmod +a 'ada allow read,write,delete,add_file,add_subdirectory,file_inherit,directory_inherit' {} +`,
    );
    expect(remediation.script).toContain(
      `sudo find '${macFolder}' -type f -exec chmod +a 'ada allow read,write' {} +`,
    );
    expect(remediation.script).toContain(
      'launchctl start com.plexapp.plexmediaserver',
    );
  });

  it('builds Windows taskkill, icacls and start commands', () => {
    const remediation = plexRemediation(
      input({
        platform: 'win32',
        serviceKind: 'windows-process',
        dbPath: windowsDb,
        user: 'Ada',
        env: { ProgramFiles: 'C:\\Program Files' },
      }),
    );
    expect(remediation.script).toContain(
      'taskkill /IM "Plex Media Server.exe" /F',
    );
    expect(remediation.script).toContain(
      `icacls "${windowsFolder}" /grant "Ada:(OI)(CI)F" /T`,
    );
    expect(remediation.script).toContain(
      'cmd /c start "" "C:\\Program Files\\Plex\\Plex Media Server\\Plex Media Server.exe"',
    );
    expect(remediation.script).not.toContain('C:/Users/Ada');
  });

  it('only includes the steps that are needed', () => {
    expect(
      plexRemediation(input({ running: false, writable: true })).steps,
    ).toEqual([]);
    expect(
      plexRemediation(input({ running: true, writable: true })).steps.map(
        (step) => step.id,
      ),
    ).toEqual(['stop-service']);
    expect(
      plexRemediation(input({ running: false, writable: false })).steps.map(
        (step) => step.id,
      ),
    ).toEqual(['grant-access']);
  });

  it('keeps Plex ownership by granting an ACL instead of chown', () => {
    const script = plexRemediation(input()).script;
    expect(script).not.toContain('chown');
    expect(script).not.toContain('chmod -R');
  });
});

describe('Plex issues', () => {
  it('reports a missing database without a fix', () => {
    const issues = plexIssues(
      input({ exists: false, writable: false, running: false }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        id: 'database-missing',
        severity: 'error',
        fixable: false,
      }),
    ]);
  });

  it('marks a read-only database as fixable when elevation is available', () => {
    const issues = plexIssues(input({ running: false }));
    expect(issues.map((issue) => issue.id)).toEqual([
      'database-not-writable',
    ]);
    expect(issues[0].fixable).toBe(true);
    expect(canAutoFixPlex(input({ running: false }))).toBe(true);
  });

  it('reports a read-only database folder because SQLite journals live there', () => {
    const issues = plexIssues(
      input({ running: false, writable: false, folderWritable: false }),
    );
    expect(issues.map((issue) => issue.id)).toEqual([
      'database-folder-not-writable',
    ]);
    expect(issues[0].detail).toContain(linuxFolder);
    expect(issues[0].fixable).toBe(true);
  });

  it('treats the folder as writable when only the database file is checked', () => {
    expect(
      plexIssues(input({ running: false, writable: false, folderWritable: true })).map(
        (issue) => issue.id,
      ),
    ).toEqual(['database-not-writable']);
  });

  it('combines file and folder write access for POSIX and Windows paths', () => {
    expect(
      plexAccessState('linux', linuxDb, (candidate) => candidate === linuxDb),
    ).toEqual({
      fileWritable: true,
      folderWritable: false,
      writable: false,
    });
    expect(plexAccessState('win32', windowsDb, () => true)).toEqual({
      fileWritable: true,
      folderWritable: true,
      writable: true,
    });
    expect(plexAccessState('darwin', macDb, () => false)).toEqual({
      fileWritable: false,
      folderWritable: false,
      writable: false,
    });
  });

  it('does not offer a fix when pkexec is missing', () => {
    const issues = plexIssues(
      input({
        running: false,
        env: { PATH: '/nonexistent' },
        existsOnDisk: (candidate) => candidate.endsWith('/bin/sh'),
      }),
    );
    expect(issues[0].fixable).toBe(false);
    expect(
      canAutoFixPlex(
        input({
          running: false,
          env: { PATH: '/nonexistent' },
          existsOnDisk: (candidate) => candidate.endsWith('/bin/sh'),
        }),
      ),
    ).toBe(false);
  });

  it('reports a running service and an undetected service', () => {
    const issues = plexIssues(
      input({ serviceKind: 'manual', writable: true }),
    );
    expect(issues.map((issue) => issue.id)).toEqual([
      'service-running',
      'service-unknown',
    ]);
  });

  it('reports a clean database with no issues', () => {
    expect(
      plexIssues(
        input({ running: false, writable: true, serviceKind: 'systemd' }),
      ),
    ).toEqual([]);
  });
});

describe('Plex elevation helpers', () => {
  it('finds helpers on a simulated PATH', () => {
    expect(
      findOnPath(
        'linux',
        'pkexec',
        { PATH: '/usr/bin:/bin' },
        (candidate) => candidate === '/usr/bin/pkexec',
      ),
    ).toBe('/usr/bin/pkexec');
    expect(
      canElevate(
        'linux',
        { PATH: '/usr/bin:/bin' },
        (candidate) => candidate === '/usr/bin/pkexec',
      ),
    ).toBe(true);
    expect(
      canElevate(
        'darwin',
        { PATH: '/usr/bin:/bin' },
        (candidate) => candidate === '/usr/bin/osascript',
      ),
    ).toBe(true);
    expect(
      canElevate(
        'win32',
        { SystemRoot: 'C:\\Windows' },
        (candidate) =>
          candidate ===
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ),
    ).toBe(true);
    expect(canElevate('freebsd')).toBe(false);
  });

  it('builds elevated requests without sudo', () => {
    const linux = plexElevationRequest(input());
    expect(linux?.posixScript).toContain(
      `find '${linuxFolder}' -type d -exec setfacl -m 'u:ada:rwx,d:u:ada:rwx' {} +`,
    );
    expect(linux?.posixScript).not.toContain('sudo');

    const windows = plexElevationRequest(
      input({
        platform: 'win32',
        serviceKind: 'windows-process',
        dbPath: windowsDb,
        user: 'Ada',
      }),
    );
    expect(windows).toEqual({
      windows: {
        file: 'icacls.exe',
        args: [windowsFolder, '/grant', 'Ada:(OI)(CI)F', '/T'],
      },
    });
  });

  it('returns a failure when no elevation helper is available', async () => {
    const fake = runner({});
    await expect(
      runElevated(
        'linux',
        { posixScript: 'true' },
        fake.run,
        { PATH: '/nonexistent' },
        () => false,
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  it('invokes the platform helpers with argv arrays', async () => {
    const linuxFake = runner({});
    await expect(
      runElevated(
        'linux',
        { posixScript: 'true' },
        linuxFake.run,
        { PATH: '' },
        (candidate) => candidate === '/usr/bin/pkexec',
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(linuxFake.calls[0]).toEqual({
      file: '/usr/bin/pkexec',
      args: ['/bin/sh', '-c', 'true'],
    });

    const macFake = runner({});
    await expect(
      runElevated(
        'darwin',
        { posixScript: 'true' },
        macFake.run,
        { PATH: '' },
        (candidate) => candidate === '/usr/bin/osascript',
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(macFake.calls[0].file).toBe('/usr/bin/osascript');
    expect(macFake.calls[0].args[0]).toBe('-e');
    expect(macFake.calls[0].args[1]).toContain('with administrator privileges');

    const winFake = runner({});
    await expect(
      runElevated(
        'win32',
        {
          windows: {
            file: 'icacls.exe',
            args: ['C:\\Plex', '/grant', 'ada:(OI)(CI)F', '/T'],
          },
        },
        winFake.run,
        { SystemRoot: 'C:\\Windows' },
        (candidate) =>
          candidate ===
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(winFake.calls[0].file).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(winFake.calls[0].args.at(-1)).toContain('Start-Process');
  });
});

describe('Plex automatic fix', () => {
  it('stops Plex, grants access and starts Plex again', async () => {
    const fake = runner({
      'systemctl is-active plexmediaserver': { stdout: 'inactive\n' },
    });
    const elevate = vi.fn().mockResolvedValue({ ok: true, detail: '' });

    const steps = await attemptPlexAutoFix({
      ...input(),
      run: fake.run,
      elevate,
    });

    expect(steps.map((step) => [step.id, step.ok])).toEqual([
      ['stop-service', true],
      ['grant-access', true],
      ['start-service', true],
    ]);
    expect(elevate).toHaveBeenCalledTimes(1);
    expect(fake.calls.map((call) => `${call.file} ${call.args.join(' ')}`)).toEqual([
      'systemctl stop plexmediaserver',
      'systemctl is-active plexmediaserver',
      'systemctl start plexmediaserver',
    ]);
  });

  it('does not start Plex when it was already stopped', async () => {
    const fake = runner({});
    const elevate = vi.fn().mockResolvedValue({ ok: true, detail: '' });

    const steps = await attemptPlexAutoFix({
      ...input({ running: false }),
      run: fake.run,
      elevate,
    });

    expect(steps.map((step) => step.id)).toEqual(['grant-access']);
    expect(fake.calls.map((call) => call.file)).not.toContain('systemctl');
  });

  it('retries a denied service stop through elevation', async () => {
    const fake = runner({
      'systemctl stop plexmediaserver': {
        code: 1,
        stderr: 'Interactive authentication required.',
      },
      'systemctl is-active plexmediaserver': { stdout: 'inactive\n' },
    });
    const elevate = vi.fn().mockResolvedValue({ ok: true, detail: '' });

    const steps = await attemptPlexAutoFix({
      ...input(),
      run: fake.run,
      elevate,
    });

    expect(steps.map((step) => [step.id, step.ok])).toEqual([
      ['stop-service', true],
      ['grant-access', true],
      ['start-service', true],
    ]);
    expect(elevate).toHaveBeenCalledTimes(2);
    expect(elevate.mock.calls[0][0]).toEqual({
      posixScript: 'systemctl stop plexmediaserver',
    });
  });

  it('keeps the manual commands when elevation is denied', async () => {
    const fake = runner({
      'systemctl stop plexmediaserver': {
        code: 1,
        stderr: 'Interactive authentication required.',
      },
    });
    const elevate = vi
      .fn()
      .mockResolvedValue({ ok: false, detail: 'User canceled authentication.' });

    const steps = await attemptPlexAutoFix({
      ...input(),
      run: fake.run,
      elevate,
    });

    expect(steps.map((step) => [step.id, step.ok])).toEqual([
      ['stop-service', false],
      ['grant-access', false],
    ]);
  });

  it('reports a denied administrator prompt', async () => {
    const fake = runner({
      'systemctl is-active plexmediaserver': { stdout: 'inactive\n' },
    });
    const elevate = vi.fn().mockResolvedValue({
      ok: false,
      detail: 'User canceled authentication.',
    });

    const steps = await attemptPlexAutoFix({
      ...input(),
      run: fake.run,
      elevate,
    });

    expect(steps).toEqual([
      expect.objectContaining({ id: 'stop-service', ok: true }),
      expect.objectContaining({
        id: 'grant-access',
        ok: false,
        detail: 'User canceled authentication.',
      }),
      expect.objectContaining({ id: 'start-service', ok: true }),
    ]);
  });
});
