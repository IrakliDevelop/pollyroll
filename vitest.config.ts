import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^pollyroll$/, replacement: src('index.ts') },
      { find: /^pollyroll\/render$/, replacement: src('render/index.ts') },
      { find: /^pollyroll\/react$/, replacement: src('react/index.ts') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    passWithNoTests: true,
    // Simulation-heavy suites run several seconds under coverage on shared CI runners.
    testTimeout: 30_000,
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/render/**',
        'src/react/**',
        'src/**/*.bench.ts',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        'src/core/notation.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
