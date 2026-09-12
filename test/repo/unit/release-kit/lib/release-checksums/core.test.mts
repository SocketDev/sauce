import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  equalHashes,
  parseHash,
  type HashAlgorithm,
} from '../../../../../../release-kit/payload/scripts/socket-release/lib/release-checksums/core.mts'

const ALGORITHMS: readonly HashAlgorithm[] = ['sha256', 'sha384', 'sha512']

function digest(algorithm: HashAlgorithm): {
  readonly hex: string
  readonly sri: string
} {
  const bytes = createHash(algorithm).update('example release').digest()
  return {
    hex: bytes.toString('hex'),
    sri: `${algorithm}-${bytes.toString('base64')}`,
  }
}

describe('release checksum hashes', () => {
  it.each(ALGORITHMS)('normalizes %s hex and SRI forms', algorithm => {
    const expected = digest(algorithm)

    expect(parseHash(expected.hex.toUpperCase())).toEqual({
      algorithm,
      hex: expected.hex,
      sri: expected.sri,
    })
    expect(parseHash(expected.sri)).toEqual({
      algorithm,
      hex: expected.hex,
      sri: expected.sri,
    })
  })

  it('compares equivalent encodings with a timing-safe digest check', () => {
    const expected = digest('sha256')

    expect(equalHashes(expected.hex, expected.sri)).toBe(true)
    expect(equalHashes(expected.hex, digest('sha512').sri)).toBe(false)
  })

  it.each(['sha1-ZXhhbXBsZQ==', 'sha256-ZXhhbXBsZQ==', 'not-a-digest', 'abc'])(
    'rejects malformed input %s',
    input => {
      expect(() => parseHash(input)).toThrow(TypeError)
    },
  )
})
