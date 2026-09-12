import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, expect, test } from 'vitest'

import { syncPluginVersions } from '../../../scripts/repo/sync-versions.mts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    safeDeleteSync(directory, { force: true, recursive: true })
  }
})

function createFixture(version?: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plugin-version-fixture-'))
  directories.push(root)
  mkdirSync(path.join(root, '.claude-plugin'))
  const fixtures = [
    [
      'package.json',
      { name: 'local-example', private: true, version: '0.0.0' },
    ],
    ['.claude-plugin/plugin.json', { name: 'example-plugin', version }],
    [
      '.claude-plugin/marketplace.json',
      {
        name: 'example-market',
        metadata: { version: '1.0.0', owner: 'example-owner' },
      },
    ],
    ['gemini-extension.json', { name: 'example-extension', version: '1.0.0' }],
  ] as const
  for (const [file, value] of fixtures) {
    writeFileSync(path.join(root, file), JSON.stringify(value))
  }
  return root
}

function readFixture(root: string, file: string): unknown {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8'))
}

test('syncs released metadata without changing the private tooling version', () => {
  const root = createFixture('2.3.4')
  const packageBefore = readFileSync(path.join(root, 'package.json'), 'utf8')
  const pluginBefore = readFileSync(
    path.join(root, '.claude-plugin/plugin.json'),
    'utf8',
  )
  syncPluginVersions({ root })
  expect(readFixture(root, '.claude-plugin/marketplace.json')).toEqual({
    name: 'example-market',
    metadata: { version: '2.3.4', owner: 'example-owner' },
  })
  expect(readFixture(root, 'gemini-extension.json')).toEqual({
    name: 'example-extension',
    version: '2.3.4',
  })
  expect(readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(
    packageBefore,
  )
  expect(
    readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'),
  ).toBe(pluginBefore)
})

test('rejects a missing plugin version before rewriting metadata', () => {
  const root = createFixture()
  const before = readFileSync(
    path.join(root, '.claude-plugin/marketplace.json'),
    'utf8',
  )
  expect(() => syncPluginVersions({ root })).toThrow(Error)
  expect(
    readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf8'),
  ).toBe(before)
})
