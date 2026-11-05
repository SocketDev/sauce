import process from 'node:process'

import { defineConfig } from 'vitest/config'

process.env['TZ'] ??= 'UTC'

const coverage = process.argv.includes('--coverage')
const fuzz = process.env['TEST_FUZZ'] === '1'
const FUZZ_GLOB = 'test/repo/**/*.fuzz.test.mts'

export default defineConfig({
  test: {
    coverage: {
      enabled: coverage,
      exclude: [
        'release-kit/**/*.d.mts',
        'release-kit/examples/**',
        'release-kit/payload/scripts/socket-release/templates/**',
      ],
      include: ['release-kit/**/*.mts', 'release-kit/**/*.mjs'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    deps: {
      interopDefault: false,
    },
    environment: 'node',
    exclude: ['**/node_modules/**', ...(fuzz ? [] : [FUZZ_GLOB])],
    globals: false,
    hookTimeout: 60_000,
    include: fuzz ? [FUZZ_GLOB] : ['test/repo/**/*.test.mts'],
    isolate: true,
    pool: 'forks',
    server: {
      deps: {
        external: [/node_modules\/@socketsecurity\/lib-stable/],
      },
    },
    testTimeout: 60_000,
  },
})
