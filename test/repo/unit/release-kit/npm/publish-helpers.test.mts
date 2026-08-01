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

import { packumentUrl } from '../../../../../release-kit/payload/scripts/socket-release/constants/npm-registry.mts'
import {
  unknownFlags,
  unknownFlagsMessage,
} from '../../../../../release-kit/payload/scripts/socket-release/_shared/cli-flags.mts'
import {
  readPublishConfigAccess,
  resolveNpmAccess,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/shared.mts'
import { stageAction } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/staged.mts'
import { readStagedShasum } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/shared.mts'
import { extractChangelogSection } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/release.mts'

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

  it('renders each unknown flag with leading dashes', () => {
    expect(unknownFlagsMessage(['dryrun'])).toBe('Unknown flag: --dryrun')
    expect(unknownFlagsMessage(['x', 'yy'])).toBe('Unknown flags: -x, --yy')
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
})
