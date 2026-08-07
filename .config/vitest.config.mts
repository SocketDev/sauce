/**
 * @file Vitest configuration.
 */
import process from 'node:process'

import { defineConfig } from 'vitest/config'

const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.argv.some(arg => arg.includes('coverage'))

const config = defineConfig({
  test: {
    deps: {
      interopDefault: false,
    },
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.{js,ts,mjs,mts,cjs}'],
    // No test/ tree exists at the root — real suites live in tests/tier*
    // (own vitest config) and scripts/test/ (node --test). A config-change
    // escalation to this root config must pass on zero matches.
    passWithNoTests: true,
    reporters: ['default'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: isCoverageEnabled,
        maxThreads: isCoverageEnabled ? 1 : 16,
        minThreads: isCoverageEnabled ? 1 : 2,
        isolate: false,
        useAtomics: true,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    bail: process.env.CI ? 1 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      exclude: [
        '**/*.config.*',
        '**/node_modules/**',
        '**/[.]**',
        '**/*.d.ts',
        '**/virtual:*',
        'coverage/**',
        'dist/**',
        'scripts/**',
        'test/**',
      ],
      all: true,
      clean: true,
      skipFull: false,
    },
  },
})

// Vitest requires a default export from config files.
// oxlint-disable-next-line socket/no-default-export -- config contract
export default config
