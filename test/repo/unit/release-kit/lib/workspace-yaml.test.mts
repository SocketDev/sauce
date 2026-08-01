/**
 * @file Branch coverage for the pnpm-workspace.yaml string helpers: catalog
 *   block parsing (quoted/unquoted/comment-tailed), list-block parsing with
 *   negations and comments, named-catalog parsing, and the splice/remove
 *   editors including the create-block, in-place-bump, and no-op paths.
 */

import { describe, expect, it } from 'vitest'

import {
  parseCatalogBlock,
  parseListBlock,
  parseNamedCatalogs,
  removeCatalogEntry,
  spliceCatalogEntry,
} from '../../../../../release-kit/payload/scripts/socket-release/lib/workspace-yaml.mts'

const WS = [
  'packages:',
  "  - '.config/fleet/oxlint-plugin'",
  '  # a comment line inside the list',
  '  - "double-quoted"',
  '  - bare-entry',
  '  - !negated',
  '',
  'catalog:',
  "  '@types/node': 26.1.1 # trailing comment",
  '  micromark: 4.0.2',
  '',
  'overrides:',
  '  glob: 13.0.6',
  '',
  'catalogs:',
  '  react17:',
  '    react: 17.0.2',
  "    'react-dom': 17.0.2",
  '  vue2:',
  '    vue: 2.7.16',
  '',
  'minimumReleaseAge: 10080',
].join('\n')

describe('parseCatalogBlock', () => {
  it('reads quoted and unquoted keys, dropping trailing comments', () => {
    const catalog = parseCatalogBlock(WS)
    expect(catalog['@types/node']).toBe('26.1.1')
    expect(catalog['micromark']).toBe('4.0.2')
    expect(Object.keys(catalog)).toHaveLength(2)
  })

  it('targets another block via blockKey', () => {
    expect(parseCatalogBlock(WS, { blockKey: 'overrides' })['glob']).toBe(
      '13.0.6',
    )
  })

  it('returns empty when the block is absent', () => {
    expect(parseCatalogBlock('packages:\n  - x\n')).toEqual({})
  })
})

describe('parseListBlock', () => {
  it('reads single/double/bare/negated entries and skips comments', () => {
    const list = parseListBlock(WS, { blockKey: 'packages' })
    expect(list).toEqual([
      '.config/fleet/oxlint-plugin',
      'double-quoted',
      'bare-entry',
      '!negated',
    ])
  })

  it('returns empty for a missing block', () => {
    expect(
      parseListBlock('catalog:\n  a: 1\n', { blockKey: 'packages' }),
    ).toEqual([])
  })
})

describe('parseNamedCatalogs', () => {
  it('reads two-level named catalogs and ignores entries with no active name', () => {
    const named = parseNamedCatalogs(WS)
    expect(named['react17']).toEqual({ react: '17.0.2', 'react-dom': '17.0.2' })
    expect(named['vue2']).toEqual({ vue: '2.7.16' })
  })

  it('returns empty when there is no catalogs block', () => {
    expect(parseNamedCatalogs('catalog:\n  a: 1\n')).toEqual({})
  })
})

describe('spliceCatalogEntry', () => {
  it('inserts alphabetically and preserves siblings', () => {
    const next = spliceCatalogEntry(WS, 'lodash', '4.17.21')
    const catalog = parseCatalogBlock(next)
    expect(catalog['lodash']).toBe('4.17.21')
    expect(catalog['micromark']).toBe('4.0.2')
    const idxTypes = next.indexOf("'@types/node'")
    const idxLodash = next.indexOf("'lodash'")
    const idxMicro = next.indexOf('micromark:')
    expect(idxTypes).toBeLessThan(idxLodash)
    expect(idxLodash).toBeLessThan(idxMicro)
  })

  it('rewrites an existing entry in place on a version bump', () => {
    const bumped = spliceCatalogEntry(WS, '@types/node', '27.0.0')
    expect(parseCatalogBlock(bumped)['@types/node']).toBe('27.0.0')
    expect(
      bumped.split('\n').filter(l => l.includes('@types/node')),
    ).toHaveLength(1)
  })

  it('is a no-op when the entry is already at the wanted version', () => {
    expect(spliceCatalogEntry(WS, 'micromark', '4.0.2')).toBe(WS)
  })

  it('creates the catalog block when none exists', () => {
    const next = spliceCatalogEntry('packages:\n  - x\n', 'semver', '7.8.5')
    expect(next.startsWith('catalog:\n')).toBe(true)
    expect(parseCatalogBlock(next)['semver']).toBe('7.8.5')
  })
})

describe('removeCatalogEntry', () => {
  it('removes the named entry regardless of its version', () => {
    const next = removeCatalogEntry(WS, '@types/node')
    expect(parseCatalogBlock(next)['@types/node']).toBeUndefined()
    expect(parseCatalogBlock(next)['micromark']).toBe('4.0.2')
  })

  it('is a no-op for an absent entry or an absent block', () => {
    expect(removeCatalogEntry(WS, 'not-present')).toBe(WS)
    expect(removeCatalogEntry('packages:\n  - x\n', 'anything')).toBe(
      'packages:\n  - x\n',
    )
  })
})
