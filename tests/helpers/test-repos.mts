/**
 * Utilities for creating and cleaning up test fixture copies.
 *
 * Each test gets its own copy of a fixture directory so tests don't interfere.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const ROOT = path.resolve(__dirname, '../..')
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures')

/**
 * Copy a fixture directory to a temp location and return the path.
 * The caller is responsible for cleanup via `cleanupTestRepo()`.
 */
export function copyFixture(fixtureName: string): string {
  const src = path.join(FIXTURES_DIR, fixtureName)
  if (!fs.existsSync(src)) {
    throw new Error(`Fixture '${fixtureName}' not found at ${src}`)
  }

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `socket-skills-test-${fixtureName}-`),
  )

  copyDirSync(src, tmpDir)
  return tmpDir
}

/**
 * Clean up a test repo directory.
 */
export function cleanupTestRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

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
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill '${skillName}' not found at ${skillPath}`)
  }
  const skillContent = fs.readFileSync(skillPath, 'utf-8')
  return (
    `You have access to the following skill:\n\n${skillContent}\n\n` +
    `Task: ${userPrompt}`
  )
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
