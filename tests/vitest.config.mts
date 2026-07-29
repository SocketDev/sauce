import { defineConfig } from 'vitest/config'

// The opt-in lanes only. Everything that runs on every clone lives under
// `test/repo/**` and is collected by the `test` / `cover` gate through
// `.config/repo/vitest.config.mts`; this config exists for the two suites a
// gate must never reach — live Socket API calls and agent-driving e2e runs.
// Both files carry a `runner-collection: opt-in lane` marker naming that
// choice. With neither env set the include list is empty and the run reports
// no test files, which is the loud answer: a lane invoked without its
// credentials should say so rather than pass having executed nothing.
const config = defineConfig({
  test: {
    root: 'tests',
    include: [
      // Only when SOCKET_API_TOKEN is set. Env-only by design — a
      // keychain-stored token must not silently opt a dev's local run into
      // live-API tier2 tests.
      // socket-api-token-getter: allow direct-env
      ...(process.env['SOCKET_API_TOKEN'] ? ['tier2-api/**/*.test.mts'] : []),
      // Only when RUN_E2E=1
      ...(process.env['RUN_E2E'] === '1'
        ? ['tier3-e2e/**/*.e2e.test.mts']
        : []),
    ],
    testTimeout: 30_000,
  },
})

// oxlint-disable-next-line socket/no-default-export -- Vitest requires a default export from config files.
export default config
