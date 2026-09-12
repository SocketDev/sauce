/**
 * @file Property fuzzing for the pnpm-workspace.yaml catalog string helpers.
 *   Splice then parse must round-trip the entry; remove then parse must drop
 *   it; splice must be idempotent for an unchanged version. Every parser must
 *   survive arbitrary text without throwing.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  parseCatalogBlock,
  parseListBlock,
  parseNamedCatalogs,
  removeCatalogEntry,
  spliceCatalogEntry,
} from '../../../../../release-kit/payload/scripts/socket-release/lib/workspace-yaml.mts'

const pkgName = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-._'.split('')),
    {
      maxLength: 24,
      minLength: 1,
    },
  )
  .map(cs => cs.join(''))
  .filter(n => n !== 'common' && !n.startsWith('.'))

const scopedName = fc
  .tuple(pkgName, pkgName)
  .map(([scope, name]) => `@${scope}/${name}`)

const anyName = fc.oneof(pkgName, scopedName)

const versionSpec = fc.oneof(
  fc
    .tuple(fc.nat({ max: 99 }), fc.nat({ max: 99 }), fc.nat({ max: 99 }))
    .map(([a, b, c]) => `${a}.${b}.${c}`),
  fc.tuple(pkgName, pkgName).map(([a, b]) => `npm:@${a}/${b}@1.0.0`),
)

const BASE = [
  'catalog:',
  "  '@types/node': 26.1.1",
  '  micromark: 4.0.2',
  "  '@vitest/ui': 4.1.10",
  '',
  'minimumReleaseAge: 10080',
].join('\n')

describe('spliceCatalogEntry', () => {
  it('an inserted entry is readable back with its exact version', () => {
    fc.assert(
      fc.property(anyName, versionSpec, (name, version) => {
        const next = spliceCatalogEntry(BASE, name, version)
        const parsed = parseCatalogBlock(next)
        expect(parsed[name]).toBe(version)
      }),
      { numRuns: 400 },
    )
  })

  it('is idempotent for the same name and version', () => {
    fc.assert(
      fc.property(anyName, versionSpec, (name, version) => {
        const once = spliceCatalogEntry(BASE, name, version)
        const twice = spliceCatalogEntry(once, name, version)
        expect(twice).toBe(once)
      }),
      { numRuns: 300 },
    )
  })

  it('a version bump rewrites in place and preserves every other entry', () => {
    fc.assert(
      fc.property(anyName, versionSpec, versionSpec, (name, v1, v2) => {
        const first = spliceCatalogEntry(BASE, name, v1)
        const bumped = spliceCatalogEntry(first, name, v2)
        expect(parseCatalogBlock(bumped)[name]).toBe(v2)
        const base = parseCatalogBlock(BASE)
        for (const key of Object.keys(base)) {
          if (key !== name) {
            expect(parseCatalogBlock(bumped)[key]).toBe(base[key])
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  it('creates the block when none exists', () => {
    fc.assert(
      fc.property(anyName, versionSpec, (name, version) => {
        const next = spliceCatalogEntry(
          'overrides:\n  glob: 13.0.6\n',
          name,
          version,
        )
        expect(parseCatalogBlock(next)[name]).toBe(version)
      }),
      { numRuns: 200 },
    )
  })
})

describe('removeCatalogEntry', () => {
  it('splice then remove leaves the name absent (round-trip)', () => {
    fc.assert(
      fc.property(anyName, versionSpec, (name, version) => {
        const added = spliceCatalogEntry(BASE, name, version)
        const removed = removeCatalogEntry(added, name)
        expect(parseCatalogBlock(removed)[name]).toBeUndefined()
      }),
      { numRuns: 400 },
    )
  })

  it('is a no-op when the entry is absent', () => {
    fc.assert(
      fc.property(anyName, name => {
        expect(removeCatalogEntry(BASE, name)).toBe(BASE)
      }),
      { numRuns: 200 },
    )
  })
})

describe('parsers never throw on arbitrary input', () => {
  it('parseCatalogBlock / parseListBlock / parseNamedCatalogs tolerate any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4000 }), text => {
        expect(() => parseCatalogBlock(text)).not.toThrow()
        expect(() =>
          parseListBlock(text, { blockKey: 'packages' }),
        ).not.toThrow()
        expect(() => parseNamedCatalogs(text)).not.toThrow()
      }),
      { numRuns: 500 },
    )
  })

  it('splice and remove tolerate arbitrary existing content', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 2000 }),
        anyName,
        versionSpec,
        (text, name, version) => {
          expect(() => spliceCatalogEntry(text, name, version)).not.toThrow()
          expect(() => removeCatalogEntry(text, name)).not.toThrow()
        },
      ),
      { numRuns: 400 },
    )
  })
})
