/**
 * @file Property fuzzing for the installer's path safety and the drift /
 *   byte-parity checker. A manifest path that could escape the install prefix
 *   is refused loudly; the sha256 comparison catches any single-byte mutation
 *   of a payload copy; and the generated manifest round-trips through the
 *   parser it feeds.
 */

import crypto from 'node:crypto'
import path from 'node:path'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  isSafePayloadPath,
  KIT_VERSION,
  MANIFEST_FILENAME,
  parseKitManifest,
} from '../../../../../release-kit/install/manifest.mts'
import { planInstall } from '../../../../../release-kit/install/plan.mts'
import {
  INSTALL_PREFIX,
  sha256Hex,
} from '../../../../../release-kit/install/seams.mts'
import {
  buildManifest,
  serializeManifest,
} from '../../../../../release-kit/gen-manifest.mts'

function manifestJson(
  files: Array<{ channels?: string[]; path: string; sha256: string }>,
): string {
  return JSON.stringify({
    files: files.map(f => ({
      channels: f.channels ?? ['common'],
      path: f.path,
      sha256: f.sha256,
    })),
    kitVersion: KIT_VERSION,
    schemaVersion: 1,
  })
}

const VALID_SHA = 'a'.repeat(64)

describe('isSafePayloadPath', () => {
  it('rejects absolute, drive-letter, and dot-dot traversal paths', () => {
    for (const bad of [
      '',
      '/etc/passwd',
      '../escape',
      '../../etc/passwd',
      'a/../../b',
      'a/../b/../../c',
      'C:\\windows',
      '\\\\server\\share',
      'nested/../../..',
      'foo/..',
    ]) {
      expect(isSafePayloadPath(bad)).toBe(false)
    }
  })

  it('accepts clean payload-relative paths', () => {
    for (const ok of [
      'bootstrap.mts',
      'publish-infra/npm/staged.mts',
      'templates/workflows/npm-publish.yml',
      'foo/bar/baz/example.mts',
    ]) {
      expect(isSafePayloadPath(ok)).toBe(true)
    }
  })

  it('accepted paths never resolve outside the install prefix', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 120 }),
        fc.string({ maxLength: 60 }),
        (rel, targetRaw) => {
          const target = path.resolve(
            '/tmp/target-root',
            targetRaw.replace(/[^a-zA-Z0-9/_-]/g, '') || 'x',
          )
          if (!isSafePayloadPath(rel)) {
            return
          }
          const base = path.resolve(target, INSTALL_PREFIX)
          const dest = path.resolve(target, INSTALL_PREFIX, rel)
          expect(dest === base || dest.startsWith(`${base}${path.sep}`)).toBe(
            true,
          )
        },
      ),
      { numRuns: 600 },
    )
  })
})

describe('parseKitManifest path safety', () => {
  it('refuses any manifest whose entry path is unsafe', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), rel => {
        const raw = manifestJson([{ path: rel, sha256: VALID_SHA }])
        if (isSafePayloadPath(rel)) {
          const parsed = parseKitManifest(raw, 'test')
          expect(parsed.files[0]!.path).toBe(rel)
        } else {
          expect(() => parseKitManifest(raw, 'test')).toThrow()
        }
      }),
      { numRuns: 500 },
    )
  })

  it('refuses classic traversal payloads with a loud error', () => {
    for (const bad of [
      '../../../etc/cron.d/example',
      '/etc/passwd',
      '..\\..\\win.ini',
    ]) {
      expect(() =>
        parseKitManifest(
          manifestJson([{ path: bad, sha256: VALID_SHA }]),
          'test',
        ),
      ).toThrow(/unsafe path|malformed/)
    }
  })
})

describe('drift / byte-parity checker', () => {
  it('any single-byte mutation of a payload copy is classified as a conflict', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 512, minLength: 1 }),
        fc.nat(),
        (bytes, seed) => {
          const original = Buffer.from(bytes)
          const idx = seed % original.length
          const mutated = Buffer.from(original)
          mutated[idx] = (mutated[idx]! + 1 + (seed % 254)) % 256
          fc.pre(!mutated.equals(original))

          const originalSha = sha256Hex(original)
          const mutatedSha = sha256Hex(mutated)
          expect(mutatedSha).not.toBe(originalSha)

          const plan = planInstall({
            entries: [
              {
                channels: ['common'],
                path: 'example.mts',
                sha256: originalSha,
              },
            ],
            targetReads: new Map([['example.mts', mutatedSha]]),
          })
          expect(plan.conflicts).toHaveLength(1)
          expect(plan.identical).toHaveLength(0)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('an identical copy is skip-identical and an absent file is a copy', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 256 }), bytes => {
        const sha = sha256Hex(Buffer.from(bytes))
        const identical = planInstall({
          entries: [{ channels: ['common'], path: 'example.mts', sha256: sha }],
          targetReads: new Map([['example.mts', sha]]),
        })
        expect(identical.identical).toHaveLength(1)
        const absent = planInstall({
          entries: [{ channels: ['common'], path: 'example.mts', sha256: sha }],
          targetReads: new Map([['example.mts', undefined]]),
        })
        expect(absent.copies).toHaveLength(1)
      }),
      { numRuns: 200 },
    )
  })

  it('sha256Hex agrees between Buffer and its utf8 string form', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        expect(sha256Hex(text)).toBe(sha256Hex(Buffer.from(text, 'utf8')))
        expect(sha256Hex(text)).toBe(
          crypto.createHash('sha256').update(text).digest('hex'),
        )
      }),
      { numRuns: 300 },
    )
  })
})

describe('generated manifest round-trips through its parser', () => {
  it('buildManifest → serializeManifest → parseKitManifest preserves every entry', () => {
    const manifest = buildManifest()
    const serialized = serializeManifest(manifest)
    const parsed = parseKitManifest(serialized, MANIFEST_FILENAME)
    expect(parsed.files.length).toBe(manifest.files.length)
    for (let i = 0; i < manifest.files.length; i += 1) {
      expect(parsed.files[i]!.path).toBe(manifest.files[i]!.path)
      expect(parsed.files[i]!.sha256).toBe(manifest.files[i]!.sha256)
    }
    for (const entry of parsed.files) {
      expect(isSafePayloadPath(entry.path)).toBe(true)
    }
  })
})
