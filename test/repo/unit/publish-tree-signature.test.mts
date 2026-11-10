// Specs for treeSignature in scripts/repo/publish.mts: the hash generate:check
// uses to notice drift anywhere in a generated directory.

import { describe, expect, it } from 'vitest'

import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import { MISSING, treeSignature } from '../../../scripts/repo/publish.mts'

function write(root: string, rel: string, content: string): void {
  const full = path.join(root, 'tree', rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tree-signature-'))
  try {
    fn(root)
  } finally {
    safeDeleteSync(root)
  }
}

function seed(root: string): void {
  write(root, 'a.md', 'alpha')
  write(root, 'nested/b.md', 'beta')
}

describe('treeSignature', () => {
  it('returns MISSING for an absent directory', () => {
    withRoot(root => {
      expect(treeSignature('tree', root)).toBe(MISSING)
    })
  })

  it('is stable and independent of creation order', () => {
    withRoot(first => {
      withRoot(second => {
        write(first, 'a.md', 'alpha')
        write(first, 'nested/b.md', 'beta')
        write(second, 'nested/b.md', 'beta')
        write(second, 'a.md', 'alpha')
        expect(treeSignature('tree', first)).toBe(treeSignature('tree', second))
        expect(treeSignature('tree', first)).toBe(treeSignature('tree', first))
      })
    })
  })

  it.each([
    ['adding a file', (root: string) => write(root, 'c.md', 'gamma')],
    ['adding a hidden file', (root: string) => write(root, '.DS_Store', 'x')],
    ['editing a file', (root: string) => write(root, 'a.md', 'ALPHA')],
    [
      'deleting a file',
      (root: string) => rmSync(path.join(root, 'tree', 'nested', 'b.md')),
    ],
    [
      'renaming a file with the same content',
      (root: string) =>
        renameSync(
          path.join(root, 'tree', 'a.md'),
          path.join(root, 'tree', 'z.md'),
        ),
    ],
    [
      'moving a file to another directory',
      (root: string) => {
        mkdirSync(path.join(root, 'tree', 'other'))
        renameSync(
          path.join(root, 'tree', 'a.md'),
          path.join(root, 'tree', 'other', 'a.md'),
        )
      },
    ],
  ])('changes after %s', (_label, mutate) => {
    withRoot(root => {
      seed(root)
      const before = treeSignature('tree', root)
      mutate(root)
      expect(treeSignature('tree', root)).not.toBe(before)
    })
  })

  it('does not confuse a file boundary with content', () => {
    withRoot(first => {
      withRoot(second => {
        write(first, 'a', 'bc')
        write(second, 'ab', 'c')
        expect(treeSignature('tree', first)).not.toBe(
          treeSignature('tree', second),
        )
      })
    })
  })

  it('ignores an empty directory', () => {
    withRoot(root => {
      seed(root)
      const before = treeSignature('tree', root)
      mkdirSync(path.join(root, 'tree', 'empty'))
      expect(treeSignature('tree', root)).toBe(before)
    })
  })
})
