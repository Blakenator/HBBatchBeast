import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { GlobalAppConfig } from '../../src/common';
import { createLogFolders } from '../../src/backend/helpers';
import { createRunManager } from '../../src/backend/run/runService';
import { buildWorkerItemConfig } from '../../src/backend/run/buildWorkerItemConfig';

/**
 * Real conversion through worker1 + HandBrakeCLI. Opt-in because it needs the
 * binary and takes a few seconds:
 *   HBB_INTEGRATION=1 pnpm test
 */
const integration = process.env.HBB_INTEGRATION === '1' ? describe : describe.skip;

const buildDir = fileURLToPath(new URL('../../.vite/build', import.meta.url));
const sample = fileURLToPath(
  new URL('../fixtures/sample.mp4', import.meta.url),
);

integration('conversion integration', () => {
  it('converts a real file through the worker pool', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-convert-'));
    const home = path.join(root, 'home');
    const sourceDir = path.join(root, 'source');
    const destinationDir = path.join(root, 'destination');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destinationDir, { recursive: true });

    createLogFolders(home);

    const sourcePath = path.join(sourceDir, 'sample.mp4');
    fs.copyFileSync(sample, sourcePath);
    const destinationPath = path.join(destinationDir, 'sample.mp4');

    const config: GlobalAppConfig = {
      lang: 'en',
      selected_config: 0,
      version_message: 'test',
      configs: [
        {
          name: 'Default',
          tab_batch: { preset: 'Very Fast 1080p30', container: '.mp4' },
          tab_system: { worker_instance_number: '1' },
        },
      ],
    };

    const manager = createRunManager(home, {
      workerCount: 1,
      entryBaseDir: buildDir,
      buildItemConfig: (item, index) =>
        buildWorkerItemConfig(config, item, index, 'linux'),
    });

    await manager.start([
      { path: sourcePath, preset: '-Z "Very Fast 1080p30"', destinationPath },
    ]);

    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const status = manager.getState().status;
        if (status === 'completed') {
          clearInterval(timer);
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error(`run did not finish: ${JSON.stringify(manager.getState().counts)}`));
      }, 60000);
    });

    const state = manager.getState();
    expect(state.counts.success, JSON.stringify(state.items)).toBe(1);
    expect(fs.existsSync(destinationPath)).toBe(true);
    expect(fs.statSync(destinationPath).size).toBeGreaterThan(0);

    fs.rmSync(root, { recursive: true, force: true });
  }, 90000);
});
