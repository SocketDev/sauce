import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { loadManifestTree } from '../../../../scripts/repo/lockstep/manifest.mts'

const scratch: string[] = []

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('root manifest entries override included entries without inherited keys', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sauce-manifest-'))
  scratch.push(directory)
  const rootPath = path.join(directory, 'lockstep.json')
  writeFileSync(
    path.join(directory, 'included.json'),
    JSON.stringify({
      rows: [],
      sites: {
        shared: { path: 'included-port' },
        included: { path: 'included-only' },
      },
      upstreams: {
        shared: {
          submodule: 'upstream/included',
          repo: 'https://example.com/included',
        },
      },
    }),
  )
  writeFileSync(
    rootPath,
    JSON.stringify({
      includes: ['included.json'],
      rows: [],
      sites: { shared: { path: 'root-port' } },
      upstreams: {
        shared: {
          submodule: 'upstream/root',
          repo: 'https://example.com/root',
        },
      },
    }),
  )
  const { merged } = loadManifestTree(rootPath)
  expect(merged.sites?.['shared']?.path).toBe('root-port')
  expect(merged.sites?.['included']?.path).toBe('included-only')
  expect(merged.upstreams?.['shared']?.submodule).toBe('upstream/root')
  expect(Object.getPrototypeOf(merged.sites)).toBeNull()
  expect(Object.getPrototypeOf(merged.upstreams)).toBeNull()
})

test('preserves a prototype-named manifest key as data', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sauce-manifest-'))
  scratch.push(directory)
  const rootPath = path.join(directory, 'lockstep.json')
  writeFileSync(
    rootPath,
    '{"rows":[],"sites":{"__proto__":{"path":"example-port"}}}',
  )
  const { merged } = loadManifestTree(rootPath)
  expect(Object.hasOwn(merged.sites!, '__proto__')).toBe(true)
  expect(merged.sites?.['__proto__']?.path).toBe('example-port')
  expect(Object.getPrototypeOf(merged.sites)).toBeNull()
})
