import { defineConfig } from 'vitest/config'

const config = defineConfig({
  test: {
    root: 'tests',
    include: [
      // Always run
      'tier1-structural/**/*.test.mts',
      // Only when SOCKET_SECURITY_API_KEY is set. Env-only by design — a
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
