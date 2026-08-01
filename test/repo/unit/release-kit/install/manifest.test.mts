/**
 * @file Channel → file-set mapping: the exact npm+github-release EXCLUSION
 *   list, `common` completeness (every payload file tagged), manifest
 *   parsing refusals, and the channels flag parser.
 */

import { describe, expect, it } from 'vitest'

import {
  channelsForPath,
  filterByChannels,
  parseChannelsFlag,
  parseKitManifest,
} from '../../../../../release-kit/install/manifest.mts'
import { walkPayload } from '../../../../../release-kit/install/effects.mts'
import { buildManifest } from '../../../../../release-kit/gen-manifest.mts'

describe('channelsForPath', () => {
  it('routes the channel-specific surfaces', () => {
    expect(channelsForPath('publish-infra/npm/registry.mts')).toEqual(['npm'])
    expect(channelsForPath('npm-publish.mts')).toEqual(['npm'])
    expect(channelsForPath('npm-web-auth.mts')).toEqual(['npm'])
    expect(channelsForPath('publish-infra/socket-oauth.mts')).toEqual(['npm'])
    expect(channelsForPath('publish-infra/cargo/staged.mts')).toEqual([
      'crates',
    ])
    expect(channelsForPath('cargo-publish.mts')).toEqual(['crates'])
    expect(channelsForPath('create-release.mts')).toEqual(['github-release'])
    expect(channelsForPath('registry-liveness-gate.mjs')).toEqual([
      'github-release',
    ])
    expect(channelsForPath('lib/release-checksums/core.mts')).toEqual([
      'github-release',
    ])
    expect(channelsForPath('publish-infra/brew/formula.mts')).toEqual(['brew'])
    expect(channelsForPath('util/pack-app-triplets.mts')).toEqual(['brew'])
    expect(
      channelsForPath('templates/actions/socket-release-app-token/action.yml'),
    ).toEqual(['brew'])
  })

  it('everything unclaimed is common (bootstrap, shared, config templates)', () => {
    expect(channelsForPath('bootstrap.mts')).toEqual(['common'])
    expect(channelsForPath('bootstrap/steps/verify.mts')).toEqual(['common'])
    expect(channelsForPath('_shared/human-gate.mts')).toEqual(['common'])
    expect(channelsForPath('util/napi-targets.mts')).toEqual(['common'])
    expect(channelsForPath('templates/config/socket-release.json')).toEqual([
      'common',
    ])
    expect(channelsForPath('templates/gitignore-block.txt')).toEqual(['common'])
  })

  it('COMPLETENESS: every real payload file is tagged with a channel', () => {
    const files = walkPayload()
    expect(files.length).toBeGreaterThan(80)
    for (const rel of files) {
      const channels = channelsForPath(rel)
      expect(channels.length, rel).toBeGreaterThan(0)
    }
  })
})

describe('filterByChannels (the npm+github-release exclusion list)', () => {
  it('npm+github-release EXCLUDES exactly the cargo/brew surfaces', () => {
    const manifest = buildManifest()
    const selected = new Set(
      filterByChannels(manifest.files, ['npm', 'github-release']).map(
        e => e.path,
      ),
    )
    // The §3.1 exclusion list for the jdm-aot channel selection.
    const excluded = manifest.files
      .map(e => e.path)
      .filter(p => !selected.has(p))
    for (const p of excluded) {
      expect(
        p.startsWith('publish-infra/cargo/') ||
          p.startsWith('publish-infra/brew/') ||
          p === 'cargo-publish.mts' ||
          p === 'brew-publish.mts' ||
          p === 'templates/workflows/cargo-publish.yml' ||
          p === 'templates/workflows/brew-publish.yml' ||
          p.startsWith('templates/actions/') ||
          p === 'util/pack-app-triplets.mts',
        p,
      ).toBe(true)
    }
    expect(excluded).toContain('cargo-publish.mts')
    expect(excluded).toContain('brew-publish.mts')
    expect(selected.has('bootstrap.mts')).toBe(true)
    expect(selected.has('npm-publish.mts')).toBe(true)
  })

  it('common is always implied', () => {
    const manifest = buildManifest()
    const onlyBrew = filterByChannels(manifest.files, ['brew'])
    expect(onlyBrew.some(e => e.path === 'bootstrap.mts')).toBe(true)
    expect(onlyBrew.some(e => e.path === 'brew-publish.mts')).toBe(true)
    expect(onlyBrew.some(e => e.path === 'cargo-publish.mts')).toBe(false)
  })
})

describe('parseKitManifest refusals', () => {
  it('rejects unparseable, foreign-schema, and malformed entries', () => {
    expect(() => parseKitManifest('nope', 'x')).toThrowError(/not valid JSON/)
    expect(() =>
      parseKitManifest('{"schemaVersion":2,"files":[]}', 'x'),
    ).toThrowError(/foreign schema/)
    expect(() =>
      parseKitManifest(
        '{"schemaVersion":1,"files":[{"path":"a","sha256":"short","channels":["common"]}]}',
        'x',
      ),
    ).toThrowError(/malformed/)
  })
})

describe('parseChannelsFlag', () => {
  it('accepts the channel list and drops the implied common', () => {
    expect(parseChannelsFlag('npm, github-release,common')).toEqual([
      'npm',
      'github-release',
    ])
  })

  it('refuses unknown channels naming the valid set', () => {
    expect(() => parseChannelsFlag('npm,docker')).toThrowError(
      /brew, crates, github-release, npm/,
    )
    expect(() => parseChannelsFlag('common')).toThrowError(/no channels/)
  })
})
