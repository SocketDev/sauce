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
const revision = '1234567890abcdef1234567890abcdef12345678'

afterEach(() => {
  vi.unstubAllEnvs()
  capture.mockReset()
})

test('reads the published registry manifest and ignores external directory overrides', async () => {
  vi.stubEnv('SOCKET_REGISTRY_DIR', '/outside/example-registry')
  capture
    .mockResolvedValueOnce({ code: 0, stdout: 'main\n' })
    .mockResolvedValueOnce({ code: 0, stdout: `${revision}\n` })
    .mockResolvedValueOnce({ code: 0, stdout: manifest })
  await expect(expandSocketRegistryWorklist()).resolves.toEqual([
    '@socketregistry/example-module',
  ])
  expect(capture).toHaveBeenNthCalledWith(
    1,
    'gh',
    ['api', 'repos/SocketDev/socket-registry', '--jq', '.default_branch'],
    expect.any(String),
  )
  expect(capture).toHaveBeenNthCalledWith(
    2,
    'gh',
    ['api', 'repos/SocketDev/socket-registry/commits/main', '--jq', '.sha'],
    expect.any(String),
  )
  expect(capture).toHaveBeenNthCalledWith(
    3,
    'gh',
    [
      'api',
      `repos/SocketDev/socket-registry/contents/registry/manifest.json?ref=${revision}`,
      '-H',
      'Accept: application/vnd.github.raw',
    ],
    expect.any(String),
  )
  expect(process.env['SOCKET_REGISTRY_DIR']).toBe('/outside/example-registry')
})

test.each([
  { results: [{ code: 1, stdout: '' }] },
  { results: [{ code: 0, stdout: '' }] },
  {
    results: [
      { code: 0, stdout: 'main' },
      { code: 0, stdout: 'not-a-revision' },
    ],
  },
  {
    results: [
      { code: 0, stdout: 'main' },
      { code: 0, stdout: revision },
      { code: 1, stdout: manifest },
    ],
  },
  {
    results: [
      { code: 0, stdout: 'main' },
      { code: 0, stdout: revision },
      { code: 0, stdout: '' },
    ],
  },
])(
  'refuses unversioned or unreadable registry evidence %#',
  async ({ results }) => {
    for (const result of results) {
      capture.mockResolvedValueOnce(result)
    }
    await expect(expandSocketRegistryWorklist()).rejects.toBeInstanceOf(Error)
  },
)
