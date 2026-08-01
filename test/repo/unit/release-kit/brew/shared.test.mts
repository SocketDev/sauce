/**
 * @file Brew pure helpers: tap normalization (both forms + refusal), the
 *   dual-grammar checksums parser (sha1/sha512 lines ignored,
 *   duplicate-conflict throws), and asset templating including <version>.
 */

import { describe, expect, it } from 'vitest'

import {
  assetNamesForTriplets,
  formulaPath,
  normalizeTap,
  parseChecksumsTxt,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/shared.mts'
import { fixture } from '../helpers.mts'

describe('normalizeTap', () => {
  it('accepts the brew slug form', () => {
    expect(normalizeTap('SocketDev/socket')).toEqual({
      repo: 'SocketDev/homebrew-socket',
      slug: 'SocketDev/socket',
    })
  })

  it('accepts the repo form', () => {
    expect(normalizeTap('SocketDev/homebrew-socket')).toEqual({
      repo: 'SocketDev/homebrew-socket',
      slug: 'SocketDev/socket',
    })
  })

  it('refuses anything else naming both forms', () => {
    expect(() => normalizeTap('just-a-name')).toThrowError(/homebrew-socket/)
  })
})

describe('parseChecksumsTxt', () => {
  it('parses the plain shasum grammar', () => {
    const map = parseChecksumsTxt(fixture('checksums/shasum-format.txt'))
    expect(map.size).toBe(4)
    expect(map.get('examplecli-darwin-arm64.tar.gz')).toBe('1'.repeat(64))
  })

  it('parses the kit sha256: grammar and ignores sha1/sha512 lines', () => {
    const map = parseChecksumsTxt(fixture('checksums/kit-format.txt'))
    expect(map.size).toBe(2)
    expect(map.get('examplecli-darwin-arm64.tar.gz')).toBe('1'.repeat(64))
    expect(map.get('examplecli-darwin-x64.tar.gz')).toBe('2'.repeat(64))
  })

  it('both grammars in one manifest agree on the same file without conflict', () => {
    const map = parseChecksumsTxt(
      `${'1'.repeat(64)}  a.tar.gz\nsha256: ${'1'.repeat(64)}  a.tar.gz\n`,
    )
    expect(map.size).toBe(1)
  })

  it('a duplicate filename with DIFFERING hex throws', () => {
    expect(() =>
      parseChecksumsTxt(fixture('checksums/duplicate-conflict.txt')),
    ).toThrowError(/differing sha256/)
  })
})

describe('asset templating', () => {
  it('expands <name>/<triplet>/<version>', () => {
    expect(
      assetNamesForTriplets(
        'examplecli',
        '1.2.3',
        '<name>-<version>-<triplet>.tar.gz',
        ['darwin-arm64', 'linux-x64'],
      ),
    ).toEqual([
      {
        asset: 'examplecli-1.2.3-darwin-arm64.tar.gz',
        triplet: 'darwin-arm64',
      },
      { asset: 'examplecli-1.2.3-linux-x64.tar.gz', triplet: 'linux-x64' },
    ])
  })

  it('formulaPath is the unsharded Formula/<name>.rb', () => {
    expect(formulaPath('examplecli')).toBe('Formula/examplecli.rb')
  })
})
