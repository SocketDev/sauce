/**
 * @file Remaining reachable branch coverage for the formula parser's partial
 *   and out-of-order blocks, the installer seams' default args and real-fs
 *   round-trip, and the workspace-yaml block-boundary paths.
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parseFormula,
  renderFormula,
} from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import type { FormulaSpec } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import { FORMULA_PLATFORMS } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import {
  parseCatalogBlock,
  parseListBlock,
  parseNamedCatalogs,
  spliceCatalogEntry,
} from '../../../../release-kit/payload/scripts/socket-release/lib/workspace-yaml.mts'
import {
  PAYLOAD_ROOT,
  readTargetShas,
  resolveInstallSeams,
  sha256Hex,
  walkPayload,
} from '../../../../release-kit/install/seams.mts'

describe('parseFormula partial and out-of-order blocks', () => {
  it('parses a formula with only the macOS arm block present', () => {
    const raw = [
      'class R < Formula',
      '  on_macos do',
      '    on_arm do',
      '      url "https://x/releases/download/v1.0.0/r-darwin-arm64.tar.gz"',
      `      sha256 "${'a'.repeat(64)}"`,
      '    end',
      '  end',
      '  def install',
      '    bin.install "r"',
      '  end',
      'end',
    ].join('\n')
    const parsed = parseFormula(raw)
    expect(parsed).toBeDefined()
    expect(parsed!.platforms['darwin-arm64']).toBeDefined()
    expect(parsed!.platforms['darwin-x64']).toBeUndefined()
    expect(parsed!.platforms['linux-arm64']).toBeUndefined()
  })

  it('ignores an arch block that has a url but no valid sha', () => {
    const raw = [
      'class R < Formula',
      '  on_linux do',
      '    on_intel do',
      '      url "https://x/releases/download/v1.0.0/r-linux-x64.tar.gz"',
      '    end',
      '  end',
      '  bin.install "r"',
      'end',
    ].join('\n')
    const parsed = parseFormula(raw)
    expect(parsed).toBeDefined()
    expect(parsed!.platforms['linux-x64']).toBeUndefined()
  })

  it('handles the linux block appearing before the macos block', () => {
    const arm = `      sha256 "${'b'.repeat(64)}"`
    const raw = [
      'class R < Formula',
      '  on_linux do',
      '    on_arm do',
      '      url "https://x/releases/download/v1.0.0/r-linux-arm64.tar.gz"',
      arm,
      '    end',
      '  end',
      '  on_macos do',
      '    on_arm do',
      '      url "https://x/releases/download/v1.0.0/r-darwin-arm64.tar.gz"',
      arm,
      '    end',
      '  end',
      '  bin.install "r"',
      'end',
    ].join('\n')
    const parsed = parseFormula(raw)
    expect(parsed).toBeDefined()
    expect(parsed!.platforms['linux-arm64']).toBeDefined()
    expect(parsed!.platforms['darwin-arm64']).toBeDefined()
  })
})

describe('renderFormula with a non-canonical version URL', () => {
  it('renders an empty version when the darwin-arm64 URL carries no version segment', () => {
    const platforms = {} as FormulaSpec['platforms']
    for (let i = 0; i < FORMULA_PLATFORMS.length; i += 1) {
      platforms[FORMULA_PLATFORMS[i]!] = {
        sha256: `${i}`.repeat(64),
        url: 'https://example.com/no-version-here.tar.gz',
      }
    }
    const rendered = renderFormula({
      className: 'R',
      desc: 'r',
      homepage: 'https://example.com',
      license: 'MIT',
      name: 'r',
      platforms,
    })
    expect(rendered).toContain('version ""')
  })
})

describe('installer seams with defaults and real fs', () => {
  it('walkPayload() and resolveInstallSeams() default to the real payload root', () => {
    const files = walkPayload()
    expect(files.length).toBeGreaterThan(0)
    expect(files).not.toContain('kit-manifest.json')
    const seams = resolveInstallSeams()
    expect(seams.readPayloadFile('bootstrap.mts')).toBeDefined()
    expect(seams.readPayloadFile('bootstrap.mts')).toBe(
      readFileSync(path.join(PAYLOAD_ROOT, 'bootstrap.mts'), 'utf8'),
    )
  })

  it('copies, hashes, and reads back a file through the real seams', () => {
    const target = mkdtempSync(path.join(os.tmpdir(), 'kit-seams-'))
    const seams = resolveInstallSeams()
    seams.copyFile('bootstrap.mts', target)
    const expected = sha256Hex(
      readFileSync(path.join(PAYLOAD_ROOT, 'bootstrap.mts')),
    )
    expect(seams.hashTargetFile('bootstrap.mts', target)).toBe(expected)
    const reads = readTargetShas(seams, ['bootstrap.mts', 'absent.mts'], target)
    expect(reads.get('bootstrap.mts')).toBe(expected)
    expect(reads.get('absent.mts')).toBeUndefined()
  })

  it('writeTargetFile creates the parent directory and targetFileExists reports it', () => {
    const target = mkdtempSync(path.join(os.tmpdir(), 'kit-seams-w-'))
    const seams = resolveInstallSeams()
    const p = path.join(target, 'nested', 'deep', 'file.txt')
    expect(seams.targetFileExists(p)).toBe(false)
    seams.writeTargetFile(p, 'hello')
    expect(seams.targetFileExists(p)).toBe(true)
    expect(readFileSync(p, 'utf8')).toBe('hello')
  })

  it('sha256Hex accepts a Buffer and a string identically', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex(Buffer.from('abc')))
  })
})

describe('workspace-yaml block boundaries', () => {
  it('stops the catalog block at a following top-level key', () => {
    const content = ['catalog:', '  a: 1', 'overrides:', '  b: 2'].join('\n')
    const catalog = parseCatalogBlock(content)
    expect(catalog).toEqual({ a: '1' })
  })

  it('inserts at the block end when the new name sorts last', () => {
    const content = ['catalog:', '  aaa: 1', '  bbb: 2'].join('\n')
    const next = spliceCatalogEntry(content, 'zzz', '9')
    expect(parseCatalogBlock(next)['zzz']).toBe('9')
    const lines = next.split('\n')
    expect(lines[lines.length - 1]).toContain('zzz')
  })

  it('skips non-matching lines inside the catalog block', () => {
    const content = [
      'catalog:',
      '  aaa: 1',
      '  # a bare comment with no colon',
      '  bbb: 2',
    ].join('\n')
    expect(parseCatalogBlock(content)).toEqual({ aaa: '1', bbb: '2' })
  })

  it('skips indented non-bullet lines inside a list block', () => {
    const content = [
      'packages:',
      "  - 'a'",
      '  indented but not a bullet',
      "  - 'b'",
    ].join('\n')
    expect(parseListBlock(content, { blockKey: 'packages' })).toEqual([
      'a',
      'b',
    ])
  })

  it('ignores orphan and comment lines inside the catalogs block', () => {
    const content = [
      'catalogs:',
      '    orphan: 1.0.0',
      '  react17:',
      '    # a comment under the name',
      '    react: 17.0.2',
    ].join('\n')
    expect(parseNamedCatalogs(content)).toEqual({
      react17: { react: '17.0.2' },
    })
  })

  it('sorts around a comment line when splicing', () => {
    const content = [
      'catalog:',
      '  aaa: 1',
      '  # comment no colon',
      '  ccc: 3',
    ].join('\n')
    const next = spliceCatalogEntry(content, 'bbb', '2')
    expect(parseCatalogBlock(next)).toMatchObject({
      aaa: '1',
      bbb: '2',
      ccc: '3',
    })
  })
})
