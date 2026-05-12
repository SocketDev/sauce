/**
 * @fileoverview Generate (or verify) the published artifacts for socket-skills.
 *
 * Replaces the legacy `publish.sh` (drops shell dependency).
 *
 * Usage:
 *   node scripts/publish.mts          Regenerate all artifacts.
 *   node scripts/publish.mts --check  Verify generated artifacts match what
 *                                     the generators would produce now;
 *                                     non-zero exit on drift.
 *
 * The generators run in dependency order:
 *   inline-shared        — replicates shared README sections.
 *   sync-versions        — propagates package.json version → derivative artifacts.
 *   generate-agents      — emits agents/AGENTS.md from the skills tree.
 *   generate-cursor-plugin — emits .cursor-plugin/plugin.json.
 *
 * In `--check` mode the file SHA-256 is captured BEFORE the generators run and
 * compared with the AFTER hash; any mismatch is a drift finding. We then
 * delegate to two `--check` sub-runners (cursor-plugin, inline-shared) for
 * structural assertions the SHA comparison wouldn't catch.
 */

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const GENERATED_FILES = [
  'agents/AGENTS.md',
  'README.md',
  '.cursor-plugin/plugin.json',
  '.mcp.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'gemini-extension.json',
] as const

const MISSING = '__MISSING__'

export function fileSig(relPath: string): string {
  const abs = path.join(rootDir, relPath)
  try {
    const buf = readFileSync(abs)
    return createHash('sha256').update(buf).digest('hex')
  } catch {
    return MISSING
  }
}

export async function runCheck(): Promise<void> {
  // Snapshot SHAs before regenerating so we can detect drift after.
  const before: Record<string, string> = Object.create(undefined)
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const p = GENERATED_FILES[i]
    before[p] = fileSig(p)
  }

  await runGenerate()

  const changed: string[] = []
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const p = GENERATED_FILES[i]
    if (fileSig(p) !== before[p]) {
      changed.push(p)
    }
  }

  if (changed.length > 0) {
    process.stderr.write('Generated artifacts are outdated.\n')
    process.stderr.write('Run: pnpm run generate\n\n')
    process.stderr.write('Changed files:\n')
    for (let i = 0, { length } = changed; i < length; i += 1) {
      const p = changed[i]
      process.stderr.write(`  ${p}\n`)
    }
    process.exit(1)
  }

  // Two follow-up structural checks the SHA compare doesn't cover.
  await runTsx('scripts/generate-cursor-plugin.ts', '--check')
  await runTsx('scripts/inline-shared.ts', '--check')

  process.stdout.write('All generated artifacts are up to date.\n')
}

export async function runGenerate(): Promise<void> {
  await runTsx('scripts/inline-shared.ts')
  await runTsx('scripts/sync-versions.ts')
  await runTsx('scripts/generate-agents.ts')
  await runTsx('scripts/generate-cursor-plugin.ts')
}

export async function runTsx(
  scriptRelPath: string,
  ...args: string[]
): Promise<void> {
  await spawn('pnpm', ['exec', 'tsx', scriptRelPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

const arg = process.argv[2]
if (arg === undefined) {
  await runGenerate()
  process.stdout.write('Publish artifacts generated successfully.\n')
} else if (arg === '--check') {
  await runCheck()
} else if (arg === '--help' || arg === '-h') {
  process.stdout.write(`Usage:
  node scripts/publish.mts          Generate all publish artifacts
  node scripts/publish.mts --check  Verify generated artifacts are up to date

This script regenerates:
  - agents/AGENTS.md
  - README.md (skills table section)
  - .cursor-plugin/plugin.json
  - .mcp.json
  - .claude-plugin/plugin.json
  - .claude-plugin/marketplace.json
  - gemini-extension.json
`)
} else {
  process.stderr.write(`Unknown option: ${arg}\n`)
  process.stderr.write('Use --help for usage.\n')
  process.exit(2)
}
