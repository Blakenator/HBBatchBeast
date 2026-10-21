import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // forked child-process integration tests need a little more room than units
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
