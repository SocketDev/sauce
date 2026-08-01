/**
 * @file The parseKitConfig refusal arms not already pinned: a non-object
 *   document, an invalid dist-tag, and every brew-block validation. Each is a
 *   loud KitError, never a silent default.
 */

import { describe, expect, it } from 'vitest'

import { parseKitConfig } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/config.mts'

const WHERE = '.config/socket-release.json'

function reject(raw: string): unknown {
  try {
    parseKitConfig(raw, WHERE)
  } catch (e) {
    return e
  }
  throw new Error('expected parseKitConfig to throw')
}

describe('parseKitConfig refusals', () => {
  it('refuses a non-object JSON document', () => {
    expect(() => parseKitConfig('42', WHERE)).toThrow(/not an object/)
    expect(() => parseKitConfig('null', WHERE)).toThrow(/not an object/)
    expect(() => parseKitConfig('[]', WHERE)).toThrow(/not an object/)
  })

  it('refuses an invalid dist-tag', () => {
    expect(() =>
      parseKitConfig(
        JSON.stringify({
          channels: ['npm'],
          npm: { distTag: '' },
          schemaVersion: 1,
        }),
        WHERE,
      ),
    ).toThrow(/distTag/)
    expect(() =>
      parseKitConfig(
        JSON.stringify({
          channels: ['npm'],
          npm: { distTag: 5 },
          schemaVersion: 1,
        }),
        WHERE,
      ),
    ).toThrow(/distTag/)
  })

  it('refuses the brew channel with no brew block', () => {
    expect(() =>
      parseKitConfig(
        JSON.stringify({ channels: ['brew'], schemaVersion: 1 }),
        WHERE,
      ),
    ).toThrow(/without a brew block/)
  })

  it('refuses a missing brew.tap', () => {
    expect(() =>
      parseKitConfig(
        JSON.stringify({
          brew: {
            assetTemplate: 'a-<triplet>.tgz',
            formula: 'a',
            triplets: ['darwin-arm64'],
          },
          channels: ['brew'],
          schemaVersion: 1,
        }),
        WHERE,
      ),
    ).toThrow(/brew\.tap/)
  })

  it('refuses a non-string brew.formula', () => {
    expect(() =>
      parseKitConfig(
        JSON.stringify({
          brew: {
            assetTemplate: 'a-<triplet>.tgz',
            formula: 5,
            tap: 'o/r',
            triplets: ['darwin-arm64'],
          },
          channels: ['brew'],
          schemaVersion: 1,
        }),
        WHERE,
      ),
    ).toThrow(/brew\.formula/)
  })

  it('refuses a missing brew.assetTemplate', () => {
    expect(() =>
      parseKitConfig(
        JSON.stringify({
          brew: { formula: 'a', tap: 'o/r', triplets: ['darwin-arm64'] },
          channels: ['brew'],
          schemaVersion: 1,
        }),
        WHERE,
      ),
    ).toThrow(/brew\.assetTemplate/)
  })

  it('refuses non-array brew.triplets', () => {
    expect(() =>
      parseKitConfig(
        JSON.stringify({
          brew: {
            assetTemplate: 'a-<triplet>.tgz',
            formula: 'a',
            tap: 'o/r',
            triplets: 'x',
          },
          channels: ['brew'],
          schemaVersion: 1,
        }),
        WHERE,
      ),
    ).toThrow(/brew\.triplets/)
  })

  it('accepts a fully-specified brew config', () => {
    const config = parseKitConfig(
      JSON.stringify({
        brew: {
          assetTemplate: '<name>-<triplet>.tar.gz',
          formula: 'examplecli',
          tap: 'SocketDev/socket',
          triplets: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
        },
        channels: ['brew'],
        schemaVersion: 1,
      }),
      WHERE,
    )
    expect(config.brew?.tap).toBe('SocketDev/socket')
    expect(config.brew?.triplets).toHaveLength(4)
  })

  it('reports the refusal as a KitError-shaped multi-line message', () => {
    const err = reject('not json at all') as Error
    expect(err.message).toMatch(/Where:/)
    expect(err.message).toMatch(/Fix:/)
  })
})
