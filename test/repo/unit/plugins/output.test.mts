// Specs for ArtifactWriter, treeSignature, and renderFormattedJson: the
// only code that writes generated plugin files.

import { describe, expect, it } from 'vitest'

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import {
  ArtifactWriter,
  MISSING,
  renderFormattedJson,
  treeSignature,
} from '../../../../scripts/repo/plugins/output.mts'
import { withFixture, writeFile } from './fixture.mts'

const read = (root: string, rel: string) =>
  readFileSync(path.join(root, ...rel.split('/')))

describe('ArtifactWriter.file and json', () => {
  it('writes a missing file and creates its directories', () => {
    withFixture(root => {
      const out = new ArtifactWriter(root, false)
      out.file('out/deep/a.txt', 'hello')
      expect(read(root, 'out/deep/a.txt').toString()).toBe('hello')
      expect(out.report()).toStrictEqual({ outdated: [], removed: [] })
    })
  })

  it('check mode reports a missing or different file and writes nothing', () => {
    withFixture(root => {
      writeFile(root, 'out/b.txt', 'old')
      writeFile(root, 'out/c.txt', 'same')
      const out = new ArtifactWriter(root, true)
      out.file('out/a.txt', 'new')
      out.file('out/b.txt', 'new')
      out.file('out/c.txt', 'same')
      expect(out.report().outdated).toStrictEqual(['out/a.txt', 'out/b.txt'])
      expect(existsSync(path.join(root, 'out', 'a.txt'))).toBe(false)
      expect(read(root, 'out/b.txt').toString()).toBe('old')
    })
  })

  it('leaves an up-to-date file alone', () => {
    withFixture(root => {
      writeFile(root, 'out/a.txt', 'same')
      const out = new ArtifactWriter(root, true)
      out.file('out/a.txt', 'same')
      expect(out.report().outdated).toStrictEqual([])
    })
  })

  it('compares bytes, not decoded text', () => {
    withFixture(root => {
      const bytes = Buffer.from([0x89, 0x50, 0xff, 0xfe])
      writeFile(root, 'out/a.bin', Buffer.from([0x89, 0x50, 0xff, 0xfd]))
      const out = new ArtifactWriter(root, true)
      out.file('out/a.bin', bytes)
      expect(out.report().outdated).toStrictEqual(['out/a.bin'])
    })
  })

  it.skipIf(process.platform === 'win32')(
    'sets and clears the executable bit, and reports a mismatch',
    () => {
      withFixture(root => {
        new ArtifactWriter(root, false).file('a.sh', 'x', { executable: true })
        expect(statSync(path.join(root, 'a.sh')).mode & 0o111).not.toBe(0)
        const check = new ArtifactWriter(root, true)
        check.file('a.sh', 'x')
        expect(check.report().outdated).toStrictEqual(['a.sh'])
        new ArtifactWriter(root, false).file('a.sh', 'x')
        expect(statSync(path.join(root, 'a.sh')).mode & 0o111).toBe(0)
      })
    },
  )

  it('json writes formatted JSON and drops undefined keys', () => {
    withFixture(root => {
      new ArtifactWriter(root, false).json('a.json', { a: 1, b: undefined })
      expect(read(root, 'a.json').toString()).toBe('{\n  "a": 1\n}\n')
    })
  })
})

describe('ArtifactWriter.tree', () => {
  function sources(root: string): Map<string, string> {
    writeFile(root, 'src/one.md', 'one')
    writeFile(root, 'src/sub/two.md', 'two')
    return new Map([
      ['one.md', path.join(root, 'src', 'one.md')],
      ['sub/two.md', path.join(root, 'src', 'sub', 'two.md')],
    ])
  }

  it('copies every file byte for byte', () => {
    withFixture(root => {
      new ArtifactWriter(root, false).tree('dest', sources(root))
      expect(read(root, 'dest/one.md').toString()).toBe('one')
      expect(read(root, 'dest/sub/two.md').toString()).toBe('two')
    })
  })

  it('check mode reports missing and stray files without touching them', () => {
    withFixture(root => {
      const files = sources(root)
      writeFile(root, 'dest/stray.md', 'x')
      writeFile(root, 'dest/.hidden', 'x')
      const out = new ArtifactWriter(root, true)
      out.tree('dest', files)
      expect(out.report().outdated.toSorted()).toStrictEqual([
        'dest/.hidden',
        'dest/one.md',
        'dest/stray.md',
        'dest/sub/two.md',
      ])
      expect(existsSync(path.join(root, 'dest', 'stray.md'))).toBe(true)
    })
  })

  it('removes stray files and empty directories but keeps the root', () => {
    withFixture(root => {
      const files = sources(root)
      writeFile(root, 'dest/old/gone.md', 'x')
      mkdirSync(path.join(root, 'dest', 'empty', 'deeper'), {
        recursive: true,
      })
      const out = new ArtifactWriter(root, false)
      out.tree('dest', files)
      expect(out.report().removed).toStrictEqual(['dest/old/gone.md'])
      expect(readdirSync(path.join(root, 'dest')).toSorted()).toStrictEqual([
        'one.md',
        'sub',
      ])
      const empty = new ArtifactWriter(root, false)
      empty.tree('dest', new Map())
      expect(existsSync(path.join(root, 'dest'))).toBe(true)
      expect(readdirSync(path.join(root, 'dest'))).toStrictEqual([])
    })
  })

  it('rewrites a case-only rename instead of deleting it', () => {
    withFixture(root => {
      const files = sources(root)
      new ArtifactWriter(root, false).tree('dest', files)
      renameSync(
        path.join(root, 'dest', 'one.md'),
        path.join(root, 'dest', 'One.md'),
      )
      new ArtifactWriter(root, false).tree('dest', files)
      expect(readdirSync(path.join(root, 'dest')).toSorted()).toStrictEqual([
        'one.md',
        'sub',
      ])
      const check = new ArtifactWriter(root, true)
      check.tree('dest', files)
      expect(check.report().outdated).toStrictEqual([])
    })
  })

  it.skipIf(process.platform === 'win32')('copies the executable bit', () => {
    withFixture(root => {
      const files = sources(root)
      chmodSync(path.join(root, 'src', 'one.md'), 0o755)
      new ArtifactWriter(root, false).tree('dest', files)
      expect(statSync(path.join(root, 'dest', 'one.md')).mode & 0o111).not.toBe(
        0,
      )
    })
  })

  it('refuses a symlink in the destination', () => {
    withFixture(root => {
      const files = sources(root)
      mkdirSync(path.join(root, 'dest'))
      symlinkSync(
        path.join(root, 'src', 'one.md'),
        path.join(root, 'dest', 'link.md'),
      )
      expect(() => new ArtifactWriter(root, false).tree('dest', files)).toThrow(
        /symlinks/,
      )
    })
  })
})

describe('ArtifactWriter.onlyEntries', () => {
  it('reports, never deletes, unexpected entries', () => {
    withFixture(root => {
      writeFile(root, 'p/ok.txt', 'x')
      writeFile(root, 'p/mcp.json', '{}')
      for (const check of [true, false]) {
        const out = new ArtifactWriter(root, check)
        out.onlyEntries('p', ['ok.txt'])
        expect(out.report().outdated).toStrictEqual(['p/mcp.json'])
      }
      expect(existsSync(path.join(root, 'p', 'mcp.json'))).toBe(true)
    })
  })

  it('does nothing when the directory is missing', () => {
    withFixture(root => {
      const out = new ArtifactWriter(root, true)
      out.onlyEntries('missing', [])
      expect(out.report().outdated).toStrictEqual([])
    })
  })
})

describe('treeSignature', () => {
  function seed(root: string): string {
    writeFile(root, 'tree/a.md', 'alpha')
    writeFile(root, 'tree/nested/b.md', 'beta')
    return path.join(root, 'tree')
  }

  it('returns MISSING for an absent directory', () => {
    withFixture(root => {
      expect(treeSignature(path.join(root, 'tree'))).toBe(MISSING)
    })
  })

  it('is stable and independent of creation order', () => {
    withFixture(first => {
      withFixture(second => {
        writeFile(second, 'tree/nested/b.md', 'beta')
        writeFile(second, 'tree/a.md', 'alpha')
        expect(treeSignature(seed(first))).toBe(
          treeSignature(path.join(second, 'tree')),
        )
      })
    })
  })

  it.each([
    ['adding a file', (d: string) => writeFileSync(path.join(d, 'c.md'), 'c')],
    [
      'adding a hidden file',
      (d: string) => writeFileSync(path.join(d, '.x'), 'x'),
    ],
    ['editing a file', (d: string) => writeFileSync(path.join(d, 'a.md'), 'A')],
    ['deleting a file', (d: string) => rmSync(path.join(d, 'nested', 'b.md'))],
    [
      'renaming a file',
      (d: string) => renameSync(path.join(d, 'a.md'), path.join(d, 'z.md')),
    ],
  ])('changes after %s', (_label, mutate) => {
    withFixture(root => {
      const dir = seed(root)
      const before = treeSignature(dir)
      mutate(dir)
      expect(treeSignature(dir)).not.toBe(before)
    })
  })

  it('does not confuse a file boundary with content', () => {
    withFixture(first => {
      withFixture(second => {
        writeFile(first, 'tree/a', 'bc')
        writeFile(second, 'tree/ab', 'c')
        expect(treeSignature(path.join(first, 'tree'))).not.toBe(
          treeSignature(path.join(second, 'tree')),
        )
      })
    })
  })

  it('ignores an empty directory', () => {
    withFixture(root => {
      const dir = seed(root)
      const before = treeSignature(dir)
      mkdirSync(path.join(dir, 'empty'))
      expect(treeSignature(dir)).toBe(before)
    })
  })
})

describe('renderFormattedJson', () => {
  it('keeps short primitive arrays inline and breaks long ones', () => {
    const longItems = Array.from({ length: 8 }, (_, i) => `item-number-${i}`)
    expect(
      renderFormattedJson({ short: ['a', 'b'], long: longItems, nested: {} }),
    ).toBe(
      '{\n' +
        '  "short": ["a", "b"],\n' +
        '  "long": [\n' +
        longItems.map(item => `    "${item}"`).join(',\n') +
        '\n  ],\n' +
        '  "nested": {}\n' +
        '}\n',
    )
  })

  it('counts the trailing comma against the print width', () => {
    const item = 'x'.repeat(69)
    expect(renderFormattedJson({ k: [item] })).toBe(
      `{\n  "k": ["${item}"]\n}\n`,
    )
    expect(renderFormattedJson({ k: [item], z: 1 })).toBe(
      `{\n  "k": [\n    "${item}"\n  ],\n  "z": 1\n}\n`,
    )
  })

  it('breaks arrays of objects and renders empty arrays', () => {
    expect(renderFormattedJson({ a: [{ b: 1 }], e: [] })).toBe(
      '{\n  "a": [\n    {\n      "b": 1\n    }\n  ],\n  "e": []\n}\n',
    )
  })

  it('renders an object of only undefined values as {}', () => {
    expect(renderFormattedJson({ a: undefined })).toBe('{}\n')
  })
})
