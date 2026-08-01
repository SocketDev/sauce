/**
 * @file The ONE release-subject resolver, covered end to end: the plain-repo
 *   shape, the publishConfig.directory redirect shape, and all four safety
 *   throws that stop a publish from staging the wrong package (empty/non-string
 *   directory, a directory escaping the repo root, a missing subject manifest,
 *   and a subject manifest with no name/version).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveReleaseSubject } from '../../../../../release-kit/payload/scripts/socket-release/_shared/release-subject.mts'

const roots: string[] = []

function makeRoot(manifest: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-subject-'))
  roots.push(root)
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
  return root
}

function writeSubject(
  root: string,
  dir: string,
  manifest: Record<string, unknown>,
): void {
  const subjectDir = path.join(root, dir)
  mkdirSync(subjectDir, { recursive: true })
  writeFileSync(path.join(subjectDir, 'package.json'), JSON.stringify(manifest))
}

afterEach(() => {
  while (roots.length) {
    rmSync(roots.pop()!, { force: true, recursive: true })
  }
})

describe('resolveReleaseSubject — plain repo', () => {
  it('points every path at the root and marks it un-redirected', () => {
    const root = makeRoot({
      name: 'plain-pkg',
      private: true,
      repository: 'github:SocketDev/plain',
      version: '1.2.3',
    })
    const subject = resolveReleaseSubject(root)
    expect(subject.redirected).toBe(false)
    expect(subject.name).toBe('plain-pkg')
    expect(subject.version).toBe('1.2.3')
    expect(subject.private).toBe(true)
    expect(subject.dir).toBe(root)
    expect(subject.packDir).toBe(root)
    expect(subject.manifestPath).toBe(path.join(root, 'package.json'))
    expect(subject.changelogPath).toBe(path.join(root, 'CHANGELOG.md'))
    expect(subject.readmePath).toBe(path.join(root, 'README.md'))
    expect(subject.repository).toBe('github:SocketDev/plain')
  })

  it('leaves name/version empty strings when the manifest omits them', () => {
    const root = makeRoot({})
    const subject = resolveReleaseSubject(root)
    expect(subject.name).toBe('')
    expect(subject.version).toBe('')
    expect(subject.private).toBeUndefined()
  })
})

describe('resolveReleaseSubject — publishConfig.directory redirect', () => {
  it('resolves the subject manifest and packs INSIDE the directory', () => {
    const root = makeRoot({
      name: 'root-private',
      private: true,
      publishConfig: { directory: 'packages/lib' },
      repository: 'github:SocketDev/mono',
      version: '0.0.0',
    })
    writeSubject(root, 'packages/lib', {
      name: '@scope/lib',
      version: '4.5.6',
    })
    const subject = resolveReleaseSubject(root)
    const dir = path.join(root, 'packages', 'lib')
    expect(subject.redirected).toBe(true)
    expect(subject.name).toBe('@scope/lib')
    expect(subject.version).toBe('4.5.6')
    expect(subject.dir).toBe(dir)
    expect(subject.packDir).toBe(dir)
    expect(subject.rootPath).toBe(root)
    expect(subject.manifestPath).toBe(path.join(dir, 'package.json'))
    expect(subject.changelogPath).toBe(path.join(dir, 'CHANGELOG.md'))
    expect(subject.readmePath).toBe(path.join(dir, 'README.md'))
  })

  it('falls back to the root repository when the subject omits one', () => {
    const root = makeRoot({
      name: 'root-private',
      publishConfig: { directory: 'sub' },
      repository: 'github:SocketDev/mono',
      version: '0.0.0',
    })
    writeSubject(root, 'sub', { name: 'child', version: '1.0.0' })
    expect(resolveReleaseSubject(root).repository).toBe('github:SocketDev/mono')
  })

  it('prefers the subject repository over the root fallback', () => {
    const root = makeRoot({
      name: 'root-private',
      publishConfig: { directory: 'sub' },
      repository: 'github:SocketDev/mono',
      version: '0.0.0',
    })
    writeSubject(root, 'sub', {
      name: 'child',
      repository: 'github:SocketDev/child',
      version: '1.0.0',
    })
    expect(resolveReleaseSubject(root).repository).toBe(
      'github:SocketDev/child',
    )
  })
})

describe('resolveReleaseSubject — safety throws', () => {
  it('throws on a non-string directory', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: 42 },
      version: '1.0.0',
    })
    expect(() => resolveReleaseSubject(root)).toThrow(/non-empty/)
  })

  it('throws on an empty-string directory', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: '' },
      version: '1.0.0',
    })
    expect(() => resolveReleaseSubject(root)).toThrow(/non-empty/)
  })

  it('throws when the directory escapes the repo root', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: '../outside' },
      version: '1.0.0',
    })
    expect(() => resolveReleaseSubject(root)).toThrow(
      /subdirectory of the repo/,
    )
  })

  it('throws when the directory resolves to the root itself', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: '.' },
      version: '1.0.0',
    })
    expect(() => resolveReleaseSubject(root)).toThrow(
      /subdirectory of the repo/,
    )
  })

  it('throws when the subject directory has no package.json', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: 'missing' },
      version: '1.0.0',
    })
    expect(() => resolveReleaseSubject(root)).toThrow(/no package\.json/)
  })

  it('throws when the subject manifest lacks a name', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: 'sub' },
      version: '1.0.0',
    })
    writeSubject(root, 'sub', { version: '1.0.0' })
    expect(() => resolveReleaseSubject(root)).toThrow(/must carry a name/)
  })

  it('throws when the subject manifest lacks a version', () => {
    const root = makeRoot({
      name: 'root',
      publishConfig: { directory: 'sub' },
      version: '1.0.0',
    })
    writeSubject(root, 'sub', { name: 'child' })
    expect(() => resolveReleaseSubject(root)).toThrow(/must carry a name/)
  })
})
