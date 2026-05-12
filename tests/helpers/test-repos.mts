/**
 * Utilities for creating and cleaning up test fixture copies.
 *
 * Each test gets its own copy of a fixture directory so tests don't interfere.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { safeDeleteSync } from '@socketsecurity/lib/fs'

const ROOT = path.resolve(__dirname, '../..')
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures')

/**
 * Build a prompt with skill instructions injected.
 *
 * Reads the SKILL.md for the given skill and wraps the user's prompt
 * with the skill content and MCP server reference. Agent-agnostic.
 */
export function buildSkillPrompt(
  skillName: string,
  userPrompt: string,
): string {
  const skillPath = path.join(ROOT, 'skills', skillName, 'SKILL.md')
  if (!existsSync(skillPath)) {
    throw new Error(`Skill '${skillName}' not found at ${skillPath}`)
  }
  const skillContent = readFileSync(skillPath, 'utf-8')
  return (
    `You have access to the following skill:\n\n${skillContent}\n\n` +
    `Task: ${userPrompt}`
  )
}

/**
 * Clean up a test repo directory.
 */
export function cleanupTestRepo(dir: string): void {
  safeDeleteSync(dir)
}

export function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Copy a fixture directory to a temp location and return the path.
 * The caller is responsible for cleanup via `cleanupTestRepo()`.
 */
export function copyFixture(fixtureName: string): string {
  const src = path.join(FIXTURES_DIR, fixtureName)
  if (!existsSync(src)) {
    throw new Error(`Fixture '${fixtureName}' not found at ${src}`)
  }

  const tmpDir = mkdtempSync(
    path.join(os.tmpdir(), `socket-skills-test-${fixtureName}-`),
  )

  copyDirSync(src, tmpDir)
  return tmpDir
}
