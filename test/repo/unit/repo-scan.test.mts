import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, test } from 'vitest'

import { REPO_ROOT } from '../../../scripts/repo/paths.mts'
import {
  readWorkingTreeFile,
  scanFiles,
  scanText,
} from '../../../scripts/repo/util/scan.mts'
import { parseStagedBlobPaths } from '../../../scripts/repo/util/staged.mts'
import { isolateGitEnv } from '../util/git-env.mts'

isolateGitEnv()

const FAKE_GITHUB_TOKEN = `ghp_${'A'.repeat(36)}`
const PRE_COMMIT = path.join(REPO_ROOT, 'scripts/repo/hooks/pre-commit.mts')
const GIT_IDENTITY = [
  '-c',
  'user.name=Test Author',
  '-c',
  'user.email=test.author@example.invalid',
]

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-scan-'))
  tempDirs.push(dir)
  return dir
}

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...GIT_IDENTITY, ...args], {
    cwd,
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
}

function runPreCommit(cwd: string) {
  return spawnSync(process.execPath, [PRE_COMMIT], { cwd, encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('scanText', () => {
  test('reports the rule and line of a hit', () => {
    expect(scanText('a.txt', `ok\ntoken=${FAKE_GITHUB_TOKEN}\n`)).toEqual([
      { file: 'a.txt', line: 2, rule: 'github-token' },
    ])
  })
})

describe('scanFiles', () => {
  test('scans the text the reader returns', () => {
    const read = (file: string) => (file === 'b.txt' ? FAKE_GITHUB_TOKEN : 'ok')
    expect(scanFiles(['a.txt', 'b.txt'], read)).toEqual([
      { file: 'b.txt', line: 1, rule: 'github-token' },
    ])
  })

  test('skips files the reader cannot find and binary files', () => {
    const read = (file: string) =>
      file === 'gone.txt' ? undefined : `\0${FAKE_GITHUB_TOKEN}`
    expect(scanFiles(['gone.txt', 'bin.dat'], read)).toEqual([])
  })

  test('propagates reader errors', () => {
    const read = () => {
      throw new Error('unreadable')
    }
    expect(() => scanFiles(['a.txt'], read)).toThrow('unreadable')
  })
})

describe('readWorkingTreeFile', () => {
  test('returns undefined for a missing file', () => {
    expect(readWorkingTreeFile(path.join(makeTempDir(), 'missing'))).toBe(
      undefined,
    )
  })

  test('returns undefined for a directory, such as a tracked directory symlink', () => {
    expect(readWorkingTreeFile(makeTempDir())).toBe(undefined)
  })

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'throws for other read errors',
    () => {
      const file = path.join(makeTempDir(), 'locked.txt')
      writeFileSync(file, 'ok\n')
      chmodSync(file, 0o000)
      expect(() => readWorkingTreeFile(file)).toThrow()
    },
  )
})

describe('parseStagedBlobPaths', () => {
  test('keeps blobs and symlinks and skips gitlinks', () => {
    const raw = [
      ':000000 100644 0000000 45b983b A',
      'b.txt',
      ':000000 120000 0000000 8d14cbf A',
      'link',
      ':000000 160000 0000000 3805689 A',
      'sub',
      '',
    ].join('\0')
    expect(parseStagedBlobPaths(raw)).toEqual(['b.txt', 'link'])
  })

  test('returns nothing for empty output', () => {
    expect(parseStagedBlobPaths('')).toEqual([])
  })
})

describe('pre-commit hook', () => {
  function makeRepo(): string {
    const dir = makeTempDir()
    git(dir, ['init', '-q'])
    return dir
  }

  test('rejects a secret that is staged and then removed from disk', () => {
    const dir = makeRepo()
    const file = path.join(dir, 'config.txt')
    writeFileSync(file, `token=${FAKE_GITHUB_TOKEN}\n`)
    git(dir, ['add', 'config.txt'])
    unlinkSync(file)
    const result = runPreCommit(dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('config.txt:1 github-token')
  })

  test('scans the staged copy, not the working tree', () => {
    const dir = makeRepo()
    const file = path.join(dir, 'config.txt')
    writeFileSync(file, `token=${FAKE_GITHUB_TOKEN}\n`)
    git(dir, ['add', 'config.txt'])
    writeFileSync(file, 'token=redacted\n')
    expect(runPreCommit(dir).status).toBe(1)
  })

  test('accepts clean staged files', () => {
    const dir = makeRepo()
    const file = path.join(dir, 'config.txt')
    writeFileSync(file, `token=${FAKE_GITHUB_TOKEN}\n`)
    git(dir, ['add', 'config.txt'])
    writeFileSync(file, 'token=redacted\n')
    git(dir, ['add', 'config.txt'])
    writeFileSync(file, `token=${FAKE_GITHUB_TOKEN}\n`)
    const result = runPreCommit(dir)
    expect(result.status, result.stderr).toBe(0)
  })

  test('accepts a staged gitlink', () => {
    const dir = makeRepo()
    const sub = path.join(dir, 'sub')
    mkdirSync(sub)
    git(sub, ['init', '-q'])
    git(sub, ['commit', '-q', '--allow-empty', '-m', 'chore: init'])
    git(dir, ['add', 'sub'])
    const result = runPreCommit(dir)
    expect(result.status, result.stderr).toBe(0)
  })
})
