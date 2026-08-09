/**
 * @file ParseKitConfig accept/reject matrix — machine fields only (KitError
 *   fields + exit codes), never prose sentences.
 */

import { describe, expect, it } from 'vitest'

import { parseKitConfig } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/config.mts'
import { KitError } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'

const WHERE = '/home/<user>/socket-release.json'

function refusal(raw: string): KitError {
  try {
    parseKitConfig(raw, WHERE)
  } catch (e) {
    expect(e).toBeInstanceOf(KitError)
    return e as KitError
  }
  return expect.unreachable() as never
}

describe('parseKitConfig accepts', () => {
  it('the template shape', () => {
    const config = parseKitConfig(
      JSON.stringify({
        brew: {
          assetTemplate: '<name>-<triplet>.tar.gz',
          formula: '',
          tap: 'SocketDev/socket',
          triplets: ['darwin-arm64'],
        },
        channels: ['npm', 'github-release'],
        npm: { access: 'restricted', distTag: 'latest' },
        schemaVersion: 1,
      }),
      WHERE,
    )
    expect(config.channels).toEqual(['npm', 'github-release'])
    expect(config.npm.access).toBe('restricted')
    expect(config.brew).toBeUndefined()
  })

  it('a brew channel with its block', () => {
    const config = parseKitConfig(
      JSON.stringify({
        brew: {
          assetTemplate: '<name>-<triplet>.tar.gz',
          formula: 'examplecli',
          tap: 'SocketDev/socket',
          triplets: ['darwin-arm64', 'linux-x64'],
        },
        channels: ['brew'],
        schemaVersion: 1,
      }),
      WHERE,
    )
    expect(config.brew?.tap).toBe('SocketDev/socket')
  })

  it('an absent npm.access stays undefined (access-resolved is a later check)', () => {
    const config = parseKitConfig(
      JSON.stringify({ channels: ['npm'], schemaVersion: 1 }),
      WHERE,
    )
    expect(config.npm.access).toBeUndefined()
    expect(config.npm.distTag).toBe('latest')
  })
})

describe('parseKitConfig rejects', () => {
  it('an unknown channel with the exact valid set in the fix field', () => {
    const e = refusal(
      JSON.stringify({ channels: ['npm', 'docker'], schemaVersion: 1 }),
    )
    expect(e.exitCode).toBe(2)
    expect(e.fields.saw).toBe('docker')
    expect(e.fields.fix).toContain('npm, crates, github-release, brew')
  })

  it('a missing/foreign schemaVersion', () => {
    const e = refusal(JSON.stringify({ channels: ['npm'] }))
    expect(e.exitCode).toBe(2)
    expect(e.fields.wanted).toBe('1')
  })

  it('empty channels', () => {
    const e = refusal(JSON.stringify({ channels: [], schemaVersion: 1 }))
    expect(e.fields.wanted).toContain('non-empty')
  })

  it('the brew channel without a brew block', () => {
    const e = refusal(JSON.stringify({ channels: ['brew'], schemaVersion: 1 }))
    expect(e.exitCode).toBe(2)
    expect(e.fields.fix).toContain('"brew"')
  })

  it('a bad access level', () => {
    const e = refusal(
      JSON.stringify({
        channels: ['npm'],
        npm: { access: 'open' },
        schemaVersion: 1,
      }),
    )
    expect(e.fields.saw).toBe('open')
    expect(e.fields.wanted).toBe('public | restricted')
  })

  it('unparseable JSON', () => {
    const e = refusal('{ nope')
    expect(e.exitCode).toBe(2)
    expect(e.fields.saw).toBe('unparseable JSON')
  })
})
