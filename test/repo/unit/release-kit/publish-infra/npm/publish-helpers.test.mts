/**
 * @file Unit coverage for the release-time publish helpers the workflows drive
 *   but nothing exercised before: the access resolver (kit config wins, then
 *   publishConfig, then the scoped/unscoped default — the regression guard for
 *   the hard-coded `--access public` bug), the already-published decision, the
 *   staged-shasum reader across both wire shapes, the packument URL's scope
 *   escaping, unknown-flag detection, and the changelog section extractor.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { packumentUrl } from '../../../../../../release-kit/payload/scripts/socket-release/constants/npm-registry.mts'
import {
  unexpectedPositionalsMessage,
  unknownFlags,
  unknownFlagsMessage,
} from '../../../../../../release-kit/payload/scripts/socket-release/_shared/cli-flags.mts'
import {
  readPublishConfigAccess,
  resolveNpmAccess,
} from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/shared.mts'
import {
  runDirect,
  stageAction,
} from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/staged.mts'
import { readStagedShasum } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/shared.mts'
import { extractChangelogSection } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/release.mts'
import {
  parsePublishArgs,
  parsePublishArgv,
} from '../../../../../../release-kit/payload/scripts/socket-release/npm-publish.mts'

describe('resolveNpmAccess', () => {
  it('honors the kit config over everything', () => {
    expect(
      resolveNpmAccess({
        kitConfigAccess: 'restricted',
        packageName: 'plain-pkg',
        publishConfigAccess: 'public',
      }),
    ).toBe('restricted')
  })

  it('falls back to publishConfig.access when the kit config is silent', () => {
    expect(
      resolveNpmAccess({
        kitConfigAccess: undefined,
        packageName: '@scope/pkg',
        publishConfigAccess: 'restricted',
      }),
    ).toBe('restricted')
  })

  it('defaults a scoped package to restricted and an unscoped one to public', () => {
    expect(resolveNpmAccess({ packageName: '@scope/pkg' })).toBe('restricted')
    expect(resolveNpmAccess({ packageName: 'plain-pkg' })).toBe('public')
  })
})

describe('readPublishConfigAccess', () => {
  it('reads publishConfig.access from a manifest, undefined when absent/invalid', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-access-'))
    const restricted = path.join(dir, 'restricted.json')
    const none = path.join(dir, 'none.json')
    const bad = path.join(dir, 'bad.json')
    writeFileSync(
      restricted,
      JSON.stringify({ publishConfig: { access: 'restricted' } }),
    )
    writeFileSync(none, JSON.stringify({ name: 'x' }))
    writeFileSync(
      bad,
      JSON.stringify({ publishConfig: { access: 'sideways' } }),
    )
    expect(readPublishConfigAccess(restricted)).toBe('restricted')
    expect(readPublishConfigAccess(none)).toBeUndefined()
    expect(readPublishConfigAccess(bad)).toBeUndefined()
    expect(
      readPublishConfigAccess(path.join(dir, 'missing.json')),
    ).toBeUndefined()
  })
})

describe('stageAction', () => {
  it('is already-published when the target is the latest dist-tag', () => {
    expect(
      stageAction({
        publishedLatest: '1.2.3',
        publishedVersions: [],
        target: '1.2.3',
      }),
    ).toBe('already-published')
  })

  it('is already-published when the target appears in the versions list', () => {
    expect(
      stageAction({
        publishedLatest: '2.0.0',
        publishedVersions: ['1.0.0', '1.2.3'],
        target: '1.2.3',
      }),
    ).toBe('already-published')
  })

  it('is stage when the target is neither latest nor a known version', () => {
    expect(
      stageAction({
        publishedLatest: '1.2.3',
        publishedVersions: ['1.0.0', '1.2.3'],
        target: '1.3.0',
      }),
    ).toBe('stage')
  })
})

describe('readStagedShasum', () => {
  it('prefers the top-level shasum shape', () => {
    expect(readStagedShasum({ shasum: 'abc123' })).toBe('abc123')
  })

  it('falls back to dist.shasum', () => {
    expect(readStagedShasum({ dist: { shasum: 'def456' } })).toBe('def456')
  })

  it('is undefined when neither shape carries a digest', () => {
    expect(readStagedShasum({})).toBeUndefined()
    expect(readStagedShasum({ shasum: '' })).toBeUndefined()
  })
})

describe('packumentUrl', () => {
  it('joins the registry base and an unscoped name', () => {
    expect(packumentUrl('lodash')).toBe('https://registry.npmjs.org/lodash')
  })

  it('un-escapes the scope @ (%40 → @) while leaving the encoded slash', () => {
    expect(packumentUrl('@socketsecurity/lib')).toBe(
      'https://registry.npmjs.org/@socketsecurity%2Flib',
    )
  })
})

describe('unknownFlags', () => {
  it('accepts a dash flag and its parseArgs camelCase mirror', () => {
    const values = { 'dry-run': true, dryRun: true, staged: true }
    expect(unknownFlags(values, ['dry-run', 'staged'])).toEqual([])
  })

  it('flags a typo that is neither the dash form nor the camelCase mirror', () => {
    const values = { dryrun: true, staged: true }
    expect(unknownFlags(values, ['dry-run', 'staged'])).toEqual(['dryrun'])
  })

  it('renders each unknown flag with leading dashes and carries the Fix line', () => {
    expect(unknownFlagsMessage(['dryrun'])).toBe(
      'Unknown flag: --dryrun.\n' +
        '  Fix: remove the flag or run with --help for the supported options.',
    )
    expect(unknownFlagsMessage(['x', 'yy'])).toBe(
      'Unknown flags: -x, --yy.\n' +
        '  Fix: remove the flag or run with --help for the supported options.',
    )
  })

  it('renders a single-character unknown flag with one dash, multi-char with two', () => {
    expect(unknownFlagsMessage(['x'])).toContain('Unknown flag: -x.')
    expect(unknownFlagsMessage(['x', 'dryrun'])).toContain(
      'Unknown flags: -x, --dryrun.',
    )
  })
})

describe('unexpectedPositionalsMessage', () => {
  it('names the stray token(s), hints the dropped dashes, and carries the Fix line', () => {
    expect(unexpectedPositionalsMessage(['approve'])).toBe(
      'Unexpected argument: approve.\n' +
        '  Fix: this command takes flags only (did you drop a leading --?); run with --help for the supported options.',
    )
    expect(unexpectedPositionalsMessage(['a', 'b'])).toBe(
      'Unexpected arguments: a, b.\n' +
        '  Fix: this command takes flags only (did you drop a leading --?); run with --help for the supported options.',
    )
  })
})

describe('parsePublishArgv captures stray positionals (dash-less mode typos)', () => {
  it('folds a bare `approve` into positionals instead of a silent --staged fallthrough', () => {
    const { positionals } = parsePublishArgv(['approve'])
    expect(positionals).toEqual(['approve'])
  })

  it('separates a trailing positional from a real flag value', () => {
    const { positionals } = parsePublishArgv(['--tag', 'latest', 'stray'])
    expect(positionals).toEqual(['stray'])
  })

  it('reports no positionals for a well-formed flag-only invocation', () => {
    expect(parsePublishArgv(['--staged', '--dry-run']).positionals).toEqual([])
  })
})

describe('runDirect --dry-run on an already-published version', () => {
  function tempRepo(version: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-direct-'))
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@scope/pkg', version }),
    )
    return dir
  }
  const alreadyPublished = async () => ({
    latest: '1.0.0',
    versions: ['1.0.0'],
  })

  it('never touches the tag + GitHub release gate (no remote mutations)', async () => {
    let releaseCalls = 0
    await runDirect('latest', {
      dryRun: true,
      root: tempRepo('1.0.0'),
      fetchPublished: alreadyPublished,
      ensureAlreadyPublishedRelease: async () => {
        releaseCalls += 1
        return true
      },
    })
    expect(releaseCalls).toBe(0)
  })

  it('runs the release gate for a real (non-dry-run) already-published direct publish', async () => {
    let releaseCalls = 0
    await runDirect('latest', {
      dryRun: false,
      root: tempRepo('1.0.0'),
      fetchPublished: alreadyPublished,
      ensureAlreadyPublishedRelease: async () => {
        releaseCalls += 1
        return true
      },
    })
    expect(releaseCalls).toBe(1)
  })
})

describe('parsePublishArgs (documented --no-* opt-outs)', () => {
  it('maps --no-reconcile to its declared key, never a phantom reconcile key', () => {
    const values = parsePublishArgs(['--no-reconcile'])
    expect(values['no-reconcile']).toBe(true)
    expect(values['reconcile']).toBeUndefined()
  })

  it('maps --no-release to its declared key, never a phantom release key', () => {
    const values = parsePublishArgs(['--approve', '--no-release'])
    expect(values['no-release']).toBe(true)
    expect(values['release']).toBeUndefined()
  })

  it('maps --no-scan to its declared key, never a phantom scan key', () => {
    const values = parsePublishArgs(['--approve', '--no-scan'])
    expect(values['no-scan']).toBe(true)
    expect(values['scan']).toBeUndefined()
  })

  it('leaves every opt-out at its false default when omitted', () => {
    const values = parsePublishArgs(['--staged'])
    expect(values['no-reconcile']).toBe(false)
    expect(values['no-release']).toBe(false)
    expect(values['no-scan']).toBe(false)
  })
})

describe('extractChangelogSection', () => {
  it('returns the section body for the version and stops at the next heading', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-changelog-'))
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.2.3' }),
    )
    writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.2.3\n\n- added a thing\n- fixed a thing\n\n## 1.2.2\n\n- older\n',
    )
    expect(extractChangelogSection('1.2.3', dir)).toBe(
      '- added a thing\n- fixed a thing',
    )
  })

  it('falls back to a one-liner when the version section is absent', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-changelog-'))
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '9.9.9' }),
    )
    writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.0.0\n\n- old\n',
    )
    expect(extractChangelogSection('9.9.9', dir)).toBe('Release 9.9.9.')
  })

  it('does not grab a longer version whose heading begins with the target (1.2.30 above 1.2.3)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-changelog-'))
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.2.3' }),
    )
    writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.2.30\n\n- notes for 1.2.30\n\n## 1.2.3\n\n- notes for 1.2.3\n',
    )
    expect(extractChangelogSection('1.2.3', dir)).toBe('- notes for 1.2.3')
  })

  it('does not grab a prerelease heading when the target is the final version (2.0.0-rc.1 above 2.0.0)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-changelog-'))
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '2.0.0' }),
    )
    writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## 2.0.0-rc.1\n\n- prerelease notes\n\n## 2.0.0\n\n- final notes\n',
    )
    expect(extractChangelogSection('2.0.0', dir)).toBe('- final notes')
  })

  it('still matches bracketed and dated headings at the version boundary', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-changelog-'))
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.2.3' }),
    )
    writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [1.2.3] - 2024-01-01\n\n- dated notes\n\n## [1.2.2]\n\n- older\n',
    )
    expect(extractChangelogSection('1.2.3', dir)).toBe('- dated notes')
  })
})
