import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, test } from 'vitest'

import { REPO_ROOT } from '../../../scripts/repo/paths.mts'
import {
  stripCommitScissors,
  validateCommitMessage,
} from '../../../scripts/repo/util/commit-message.mts'

const COMMIT_MSG = path.join(REPO_ROOT, 'scripts/repo/hooks/commit-msg.mts')

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

function runCommitMsg(message: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-msg-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'COMMIT_EDITMSG')
  writeFileSync(file, message)
  return spawnSync(process.execPath, [COMMIT_MSG, file], { encoding: 'utf8' })
}

describe('validateCommitMessage', () => {
  test('accepts a Conventional Commit subject', () => {
    expect(validateCommitMessage('fix(check): skip gitlinks\n')).toBe(undefined)
  })

  test('accepts git-generated subjects', () => {
    expect(validateCommitMessage('fixup! fix: something')).toBe(undefined)
    expect(validateCommitMessage("Merge branch 'main'")).toBe(undefined)
  })

  test('rejects a subject without a known type', () => {
    expect(validateCommitMessage('update things')).toContain(
      'is not a Conventional Commit',
    )
    expect(validateCommitMessage('wip: update things')).toContain(
      'is not a Conventional Commit',
    )
  })

  test('rejects an empty message', () => {
    expect(validateCommitMessage('# only a comment\n')).toBe(
      'The commit message is empty.',
    )
  })

  test('rejects an AI attribution trailer', () => {
    expect(
      validateCommitMessage(
        'chore: tidy\n\nCo-Authored-By: Claude <noreply@example.invalid>\n',
      ),
    ).toContain('AI attribution')
  })
})

describe('stripCommitScissors', () => {
  test('drops everything below the scissors line', () => {
    const scissors = `# ${'-'.repeat(24)} >8 ${'-'.repeat(24)}`
    expect(stripCommitScissors(`fix: a\n${scissors}\ndiff --git\n`)).toBe(
      'fix: a\n',
    )
  })
})

describe('commit-msg hook', () => {
  test('accepts a valid message', () => {
    const result = runCommitMsg('docs: explain the release flow\n')
    expect(result.status, result.stderr).toBe(0)
  })

  test('rejects an invalid message', () => {
    const result = runCommitMsg('did some stuff\n')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('commit-msg:')
  })
})
