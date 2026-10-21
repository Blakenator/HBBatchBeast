import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChildSupervisor } from '../src/backend/processes/childSupervisor';
import { ChildMessage, QueueBuildResult } from '../src/backend/processes/protocol';

const fixture = fileURLToPath(
  new URL('./fixtures/protocol-child.cjs', import.meta.url),
);

const supervisors: ChildSupervisor[] = [];

function makeSupervisor(
  mode: string,
  overrides: Partial<ConstructorParameters<typeof ChildSupervisor>[0]> = {},
  events: ConstructorParameters<typeof ChildSupervisor>[0]['events'] = {},
) {
  const supervisor = new ChildSupervisor({
    name: `fixture-${mode}`,
    entry: fixture,
    env: { FIXTURE_MODE: mode },
    readyTimeoutMs: 3000,
    shutdownGraceMs: 300,
    killGraceMs: 300,
    events,
    ...overrides,
  });
  supervisors.push(supervisor);
  return supervisor;
}

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((s) => s.stop('test-cleanup')));
});

describe('ChildSupervisor', () => {
  it('resolves start on the ready handshake and forwards typed messages', async () => {
    const logs: string[] = [];
    const progress: number[] = [];
    let completed: QueueBuildResult | undefined;
    let readyCount = 0;

    const supervisor = makeSupervisor('ok', {}, {
      onLog: (_level, message) => logs.push(message),
      onProgress: (_phase, count) => progress.push(count),
      onChildMessage: (message: ChildMessage) => {
        if (message.type === 'ready') readyCount += 1;
        if (message.type === 'complete') completed = message.payload;
      },
    });

    await supervisor.start();
    expect(readyCount).toBe(1);

    supervisor.configure({ sources: [] });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(progress).toEqual([5]);
    expect(logs).toContain('configured');
    expect(completed?.total).toBe(1);
  });

  it('rejects start when the child exits before it is ready', async () => {
    const supervisor = makeSupervisor('crash-before-ready');

    await expect(supervisor.start()).rejects.toThrow(/exited before becoming ready/);
  });

  it('reports an error when the child exits unexpectedly', async () => {
    const errors: Error[] = [];
    const supervisor = makeSupervisor('crash-after-ready', {}, {
      onError: (error) => errors.push(error),
    });

    await supervisor.start();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(errors.some((error) => /exited unexpectedly/.test(error.message))).toBe(
      true,
    );
  });

  it('escalates to SIGKILL when the child ignores shutdown and SIGTERM', async () => {
    const logs: string[] = [];
    const supervisor = makeSupervisor('hang', {}, {
      onLog: (_level, message) => logs.push(message),
    });

    await supervisor.start();
    await supervisor.stop('test');

    expect(logs.some((message) => message.includes('SIGKILL'))).toBe(true);
    expect(supervisor.isRunning).toBe(false);
  });

  it('watches the run timeout and stops the child', async () => {
    const errors: Error[] = [];
    const supervisor = makeSupervisor(
      'hang',
      { runTimeoutMs: 150 },
      { onError: (error) => errors.push(error) },
    );

    await supervisor.start();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(errors.some((error) => /exceeded its run timeout/.test(error.message))).toBe(
      true,
    );
    expect(supervisor.isRunning).toBe(false);
  });

  it('restarts a crashed child when a restart budget is configured', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-fixture-'));
    const logs: string[] = [];
    let readyCount = 0;

    const supervisor = makeSupervisor(
      'flaky',
      {
        restartAttempts: 1,
        env: { FIXTURE_MODE: 'flaky', FIXTURE_MARKER: path.join(root, 'marker') },
      },
      {
        onLog: (_level, message) => logs.push(message),
        onChildMessage: (message) => {
          if (message.type === 'ready') readyCount += 1;
        },
      },
    );

    await supervisor.start().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 800));

    fs.rmSync(root, { recursive: true, force: true });
    expect(logs.some((message) => message.includes('restarting'))).toBe(true);
    expect(readyCount).toBeGreaterThanOrEqual(1);
  });

  it('sends a legacy shutdown command to children that ignore the typed protocol', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-fixture-'));
    const marker = path.join(root, 'suicide');

    const supervisor = makeSupervisor('legacy-suicide', {
      shutdownMessage: ['suicide'],
      env: {
        FIXTURE_MODE: 'legacy-suicide',
        FIXTURE_MARKER: marker,
      },
    });

    await supervisor.start();
    await supervisor.stop('test');

    expect(fs.readFileSync(marker, 'utf8')).toBe('suicide');
    expect(supervisor.isRunning).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('shutdownAll stops every registered child', async () => {
    const first = makeSupervisor('ok');
    const second = makeSupervisor('ok');

    await first.start();
    await second.start();

    await ChildSupervisor.shutdownAll('test-shutdown');

    expect(first.isRunning).toBe(false);
    expect(second.isRunning).toBe(false);
  });
});
