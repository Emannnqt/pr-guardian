import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Tests must never reach a live model API or GitHub; keep them fast and hermetic.
    testTimeout: 10_000,
    restoreMocks: true,
    unstubEnvs: true,
  },
});
