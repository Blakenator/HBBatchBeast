import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

let server: ViteDevServer;

beforeAll(async () => {
  server = await createServer({
    configFile: fileURLToPath(
      new URL('../vite.renderer.config.mts', import.meta.url),
    ),
    root: projectRoot,
    server: { middlewareMode: true },
    logLevel: 'silent',
  });
}, 60_000);

afterAll(async () => {
  await server?.close();
});

describe('renderer fast refresh', () => {
  it('wires component modules to React Fast Refresh', async () => {
    const result = await server.transformRequest(
      '/src/frontend/ui/Button.tsx',
    );

    expect(result?.code).toContain('$RefreshReg$');
    expect(result?.code).toContain('import.meta.hot');
  });

  it('keeps the application root refreshable', async () => {
    const result = await server.transformRequest('/src/frontend/App.tsx');

    expect(result?.code).toContain('$RefreshReg$');
  });

  it('loads the renderer entry from index.html', () => {
    const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

    expect(html).toMatch(/src=['"]\/src\/renderer\.tsx['"]/);
  });
});
