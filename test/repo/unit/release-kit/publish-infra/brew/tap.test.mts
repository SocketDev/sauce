/**
 * @file RunBrewPublish through fake BrewSeams: the four ordered refusals
 *   (tag / draft / asset / checksums — check ids + exit 1 + ZERO commit
 *   calls), the unchanged no-op, the dry-run default, the apply commit shape,
 *   and the re-read-mismatch saved-state-unproven exit.
 */

import { describe, expect, it } from 'vitest'

import { runBrewPublish } from '../../../../../../release-kit/payload/scripts/socket-release/brew-publish.mts'
import type { BrewSeams } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/tap.mts'
import { renderFormula } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import type { FormulaSpec } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import { fixture } from '../../helpers.mts'

const ASSETS = [
  'examplecli-darwin-arm64.tar.gz',
  'examplecli-darwin-x64.tar.gz',
  'examplecli-linux-arm64.tar.gz',
  'examplecli-linux-x64.tar.gz',
]

interface FakeBrew {
  commits: Array<{
    content: string
    message: string
    path: string
    repo: string
  }>
  seams: BrewSeams
}

function fakeBrewSeams(config?: {
  assets?: string[] | undefined
  checksums?: string | undefined
  commitEcho?: boolean | undefined
  isDraft?: boolean | undefined
  releaseExists?: boolean | undefined
  tagExists?: boolean | undefined
  tapFormula?: string | undefined
}): FakeBrew {
  const cfg = { __proto__: null, ...config } as NonNullable<typeof config>
  const commits: FakeBrew['commits'] = []
  let tapContent = cfg.tapFormula
  const seams: BrewSeams = {
    commitFile: async c => {
      commits.push({ ...c })
      if (cfg.commitEcho !== false) {
        tapContent = c.content
      }
    },
    downloadChecksums: async () =>
      cfg.checksums === undefined
        ? fixture('checksums/shasum-format.txt')
        : cfg.checksums || undefined,
    ghApiJson: async p =>
      p.includes('/git/ref/tags/')
        ? (cfg.tagExists ?? true)
          ? { body: { object: { sha: 'abc' } }, code: 0 }
          : { body: undefined, code: 1 }
        : { body: {}, code: 0 },
    ghReleaseView: async () => ({
      assets: cfg.assets ?? ASSETS,
      exists: cfg.releaseExists ?? true,
      isDraft: cfg.isDraft ?? false,
    }),
    readTapFile: async () =>
      tapContent === undefined ? undefined : { content: tapContent, sha: 'x' },
  }
  return { commits, seams }
}

function run(fake: FakeBrew, overrides?: Record<string, unknown>) {
  return runBrewPublish({
    apply: false,
    brewConfig: {
      assetTemplate: '<name>-<triplet>.tar.gz',
      formula: 'examplecli',
      tap: 'SocketDev/socket',
      triplets: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
    },
    json: false,
    repoRoot: '/tmp/example-repo',
    seams: fake.seams,
    slug: 'SocketDev/example-cli',
    tag: 'v1.2.3',
    ...overrides,
  })
}

describe('refusals (exit 1, zero commits)', () => {
  it('tag not on origin → tag-on-origin', async () => {
    const fake = fakeBrewSeams({ tagExists: false })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(1)
    expect(result.checks.at(-1)!.id).toBe('tag-on-origin')
    expect(fake.commits).toEqual([])
  })

  it('draft release → release-published', async () => {
    const fake = fakeBrewSeams({ isDraft: true })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(1)
    expect(result.checks.at(-1)!.id).toBe('release-published')
    expect(fake.commits).toEqual([])
  })

  it('missing asset → assets-present naming the asset', async () => {
    const fake = fakeBrewSeams({ assets: ASSETS.slice(0, 3) })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(1)
    const check = result.checks.at(-1)!
    expect(check.id).toBe('assets-present')
    expect(check.saw).toContain('examplecli-linux-x64.tar.gz')
    expect(fake.commits).toEqual([])
  })

  it('missing checksums.txt → checksums-authority pointing at github-release.mts, never the dead create-release.mts', async () => {
    const fake = fakeBrewSeams({ checksums: '' })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(1)
    const check = result.checks.at(-1)!
    expect(check.id).toBe('checksums-authority')
    expect(check.fix).toContain('github-release.mts')
    expect(check.fix).not.toContain('create-release.mts')
    expect(fake.commits).toEqual([])
  })

  it('a checksums.txt not covering an asset → checksums-cover-assets', async () => {
    const fake = fakeBrewSeams({
      checksums: `${'1'.repeat(64)}  examplecli-darwin-arm64.tar.gz\n`,
    })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(1)
    expect(result.checks.at(-1)!.id).toBe('checksums-cover-assets')
    expect(fake.commits).toEqual([])
  })
})

function desiredSpec(): FormulaSpec {
  return {
    className: 'Examplecli',
    desc: 'examplecli (Socket release)',
    homepage: 'https://github.com/SocketDev/example-cli',
    license: 'MIT',
    name: 'examplecli',
    platforms: {
      'darwin-arm64': {
        sha256: '1'.repeat(64),
        url: 'https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-darwin-arm64.tar.gz',
      },
      'darwin-x64': {
        sha256: '2'.repeat(64),
        url: 'https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-darwin-x64.tar.gz',
      },
      'linux-arm64': {
        sha256: '3'.repeat(64),
        url: 'https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-linux-arm64.tar.gz',
      },
      'linux-x64': {
        sha256: '4'.repeat(64),
        url: 'https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-linux-x64.tar.gz',
      },
    },
  }
}

describe('no-op and dry-run', () => {
  it('an identical formula → unchanged, exit 0, zero commits', async () => {
    const fake = fakeBrewSeams({ tapFormula: renderFormula(desiredSpec()) })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(0)
    expect(result.action).toBe('unchanged')
    expect(fake.commits).toEqual([])
  })

  it('dry-run default performs zero mutating seam calls', async () => {
    const fake = fakeBrewSeams()
    const result = await run(fake)
    expect(result.exitCode).toBe(0)
    expect(result.action).toBe('create')
    expect(fake.commits).toEqual([])
  })
})

describe('apply', () => {
  it('commits once with the expected {repo, path, message, content}', async () => {
    const fake = fakeBrewSeams()
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(0)
    expect(fake.commits).toHaveLength(1)
    expect(fake.commits[0]).toEqual({
      content: renderFormula(desiredSpec()),
      message: 'chore: bump examplecli to 1.2.3',
      path: 'Formula/examplecli.rb',
      repo: 'SocketDev/homebrew-socket',
    })
  })

  it('a re-read mismatch is saved-state unproven (exit 1)', async () => {
    const fake = fakeBrewSeams({ commitEcho: false })
    const result = await run(fake, { apply: true })
    expect(result.exitCode).toBe(1)
    expect(result.checks.at(-1)!.id).toBe('formula-verified')
    expect(result.checks.at(-1)!.ok).toBe(false)
  })
})
