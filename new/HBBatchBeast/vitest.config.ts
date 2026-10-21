import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // @superflag/super-ipc ships ESM with extensionless relative imports, which
    // Node's ESM loader rejects. Running them through Vite's resolver fixes it.
    deps: {
      inline: [/@superflag\/super-ipc/],
    },
    // forked child-process integration tests need a little more room than units
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
