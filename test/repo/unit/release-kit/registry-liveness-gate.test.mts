/**
 * @file The registry-liveness gate github-release.yml runs on the runner's
 *   system Node before any install. It cuts the tag + immutable release only
 *   once the version resolves on its registry, so a false green here would
 *   publish a release for a package that was never actually published. Every
 *   pure decision function is pinned, and runGate is driven end-to-end with an
 *   injected fetch across the live / 404 / unreachable cases with the network
 *   closed.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  cacheBustedNpmUrl,
  checkNpmLive,
  crateIndexPath,
  deriveCrateNames,
  indexHasVersion,
  planGate,
  runGate,
  versionFromTag,
} from '../../../../release-kit/payload/scripts/socket-release/registry-liveness-gate.mjs'

const GATE_SOURCE = fileURLToPath(
  new URL(
    '../../../../release-kit/payload/scripts/socket-release/registry-liveness-gate.mjs',
    import.meta.url,
  ),
)

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-gate-'))
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body)
  }
  return dir
}

const okFetch = async () => ({ ok: true, text: async () => '' }) as Response
const notFoundFetch = async () =>
  ({ ok: false, status: 404, text: async () => '' }) as Response
const unreachableFetch = async () => {
  throw new Error('connect ETIMEDOUT')
}

describe('versionFromTag', () => {
  it('strips a single leading v, leaves a bare version alone', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3')
    expect(versionFromTag('1.2.3')).toBe('1.2.3')
  })
})

describe('crateIndexPath', () => {
  it('shards by name length like the crates.io sparse index', () => {
    expect(crateIndexPath('a')).toBe('1/a')
    expect(crateIndexPath('ab')).toBe('2/ab')
    expect(crateIndexPath('abc')).toBe('3/a/abc')
    expect(crateIndexPath('serde')).toBe('se/rd/serde')
  })
})

describe('indexHasVersion', () => {
  it('matches the exact vers token', () => {
    expect(indexHasVersion('{"vers":"1.2.3"}', '1.2.3')).toBe(true)
    expect(indexHasVersion('{"vers":"1.2.30"}', '1.2.3')).toBe(false)
  })
})

describe('cacheBustedNpmUrl', () => {
  it('appends the nonce with the right separator', () => {
    expect(cacheBustedNpmUrl('https://r/x', 'n1')).toBe('https://r/x?_cb=n1')
    expect(cacheBustedNpmUrl('https://r/x?a=1', 'n2')).toBe(
      'https://r/x?a=1&_cb=n2',
    )
  })
})

describe('planGate', () => {
  it('plans npm for a public package.json', () => {
    const dir = tempRepo({ 'package.json': '{"name":"pkg","version":"1.0.0"}' })
    expect(planGate(dir)).toEqual({ name: 'pkg', registry: 'npm' })
  })

  it('falls through a private package.json to Cargo.toml', () => {
    const dir = tempRepo({
      'package.json': '{"name":"pkg","private":true}',
      'Cargo.toml': '[package]\nname = "crate-x"\nversion = "1.0.0"\n',
    })
    expect(planGate(dir)).toEqual({ names: ['crate-x'], registry: 'crates' })
  })

  it('skips a repo with neither manifest', () => {
    expect(planGate(tempRepo({}))).toEqual({ registry: 'none' })
  })
})

describe('loads on the runner system Node <22 (globSync deferred, not statically imported)', () => {
  it('does not statically import globSync from node:fs (a Node 22+ named export)', () => {
    const src = readFileSync(GATE_SOURCE, 'utf8')
    const fsImport = /import\s*\{([^}]*)\}\s*from\s*'node:fs'/.exec(src)
    expect(fsImport).not.toBeNull()
    expect(fsImport![1]).not.toContain('globSync')
  })

  it('still expands a workspace-member glob (globSync resolved lazily at call time)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-gate-glob-'))
    writeFileSync(
      path.join(dir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n',
    )
    mkdirSync(path.join(dir, 'crates', 'alpha'), { recursive: true })
    writeFileSync(
      path.join(dir, 'crates', 'alpha', 'Cargo.toml'),
      '[package]\nname = "alpha"\nversion = "1.0.0"\n',
    )
    expect(deriveCrateNames(dir)).toEqual(['alpha'])
  })
})

describe('checkNpmLive', () => {
  it('is true on a resolvable read', async () => {
    expect(await checkNpmLive('pkg', '1.0.0', okFetch, () => {})).toBe(true)
  })

  it('is false on a 404', async () => {
    expect(await checkNpmLive('pkg', '1.0.0', notFoundFetch, () => {})).toBe(
      false,
    )
  })

  it('is false (never throws) when the registry is unreachable', async () => {
    expect(await checkNpmLive('pkg', '1.0.0', unreachableFetch, () => {})).toBe(
      false,
    )
  })
})

describe('runGate', () => {
  const npmRepo = () =>
    tempRepo({ 'package.json': '{"name":"pkg","version":"1.0.0"}' })

  it('exits 1 when TAG is unset', async () => {
    expect(
      await runGate({
        log: () => {},
        logError: () => {},
        rootDir: npmRepo(),
        tag: undefined,
      }),
    ).toBe(1)
  })

  it('exits 0 when the version is live on npm', async () => {
    expect(
      await runGate({
        fetchImpl: okFetch,
        log: () => {},
        logError: () => {},
        rootDir: npmRepo(),
        tag: 'v1.0.0',
      }),
    ).toBe(0)
  })

  it('exits 1 when the version 404s (staged-but-not-approved)', async () => {
    expect(
      await runGate({
        fetchImpl: notFoundFetch,
        log: () => {},
        logError: () => {},
        rootDir: npmRepo(),
        tag: 'v1.0.0',
      }),
    ).toBe(1)
  })

  it('exits 1 when the registry is unreachable', async () => {
    expect(
      await runGate({
        fetchImpl: unreachableFetch,
        log: () => {},
        logError: () => {},
        rootDir: npmRepo(),
        tag: 'v1.0.0',
      }),
    ).toBe(1)
  })

  it('exits 0 (skips) for a github-release-only repo', async () => {
    expect(
      await runGate({
        fetchImpl: unreachableFetch,
        log: () => {},
        logError: () => {},
        rootDir: tempRepo({}),
        tag: 'v1.0.0',
      }),
    ).toBe(0)
  })
})
