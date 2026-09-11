import process from 'node:process'
import { afterEach, expect, test, vi } from 'vitest'

const capture = vi.hoisted(() => vi.fn())

vi.mock(
  import('../../../../../../release-kit/payload/scripts/socket-release/publish-infra/shared.mts'),
  async original => ({
    ...(await original()),
    runCapture: capture,
  }),
)

import { expandSocketRegistryWorklist } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/trusted-publisher-browser.mts'

const manifest = JSON.stringify({
  npm: [
    ['pkg:npm/%40socketregistry%2Fexample-module@1.0.0', {}],
    ['pkg:npm/example-unscoped@1.0.0', { name: 'example-unscoped' }],
  ],
})

afterEach(() => {
  vi.unstubAllEnvs()
  capture.mockReset()
})

test('reads the published registry manifest and ignores external directory overrides', async () => {
  vi.stubEnv('SOCKET_REGISTRY_DIR', '/outside/example-registry')
  capture.mockResolvedValue({ code: 0, stdout: manifest })
  await expect(expandSocketRegistryWorklist()).resolves.toEqual([
    '@socketregistry/example-module',
  ])
  expect(capture).toHaveBeenCalledWith(
    'gh',
    [
      'api',
      'repos/SocketDev/socket-registry/contents/registry/manifest.json',
      '-H',
      'Accept: application/vnd.github.raw',
    ],
    expect.any(String),
  )
  expect(process.env['SOCKET_REGISTRY_DIR']).toBe('/outside/example-registry')
})

test.each([
  { code: 1, stdout: manifest },
  { code: 0, stdout: '' },
])('refuses an unreadable published manifest %#', async result => {
  capture.mockResolvedValue(result)
  await expect(expandSocketRegistryWorklist()).rejects.toBeInstanceOf(Error)
})
