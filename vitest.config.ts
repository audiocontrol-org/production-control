import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.spec.ts'],
          exclude: ['tests/fixtures/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/integration/**/*.spec.ts'],
          exclude: ['tests/fixtures/**'],
          // The integration tests drive the BUILT binary (exit codes are the contract, and an
          // exit code is a property of a process). Building once here — rather than in each
          // file's beforeAll — keeps parallel test files from racing each other into dist/.
          globalSetup: ['tests/integration/global-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.test.ts', 'tests/contract/**/*.spec.ts'],
          exclude: ['tests/fixtures/**'],
        },
      },
    ],
  },
});
