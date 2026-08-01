/**
 * @file The 3-line release checksum writer: its output parses under the brew
 *   tier's parseChecksumsTxt (the two tiers share one grammar), and the
 *   sha256 line round-trips a fixture tarball digest.
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { formatReleaseChecksums } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/release.mts'
import { parseChecksumsTxt } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/shared.mts'

describe('formatReleaseChecksums ↔ parseChecksumsTxt', () => {
  const bytes = Buffer.from('fixture tarball bytes — deterministic digest')
  const name = 'example-lib-1.0.0.tgz'

  it('emits exactly three lines per asset', () => {
    const text = formatReleaseChecksums(name, bytes)
    const lines = text.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]!.startsWith('sha1: ')).toBe(true)
    expect(lines[1]!.startsWith('sha256: ')).toBe(true)
    expect(lines[2]!.startsWith('sha512-base64: ')).toBe(true)
  })

  it('the sha256 line round-trips the fixture digest through the brew parser', () => {
    const text = formatReleaseChecksums(name, bytes)
    const map = parseChecksumsTxt(text)
    expect(map.size).toBe(1)
    expect(map.get(name)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('multi-asset manifests concatenate without conflict', () => {
    const text =
      formatReleaseChecksums('a.tgz', Buffer.from('a')) +
      formatReleaseChecksums('b.tgz', Buffer.from('b'))
    const map = parseChecksumsTxt(text)
    expect([...map.keys()].toSorted()).toEqual(['a.tgz', 'b.tgz'])
  })
})
