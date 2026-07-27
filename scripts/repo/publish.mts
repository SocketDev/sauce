/**
 * @file Generate or verify the checked-in artifacts published by socket-skills.
 *   This is a repo-owned generator, not the fleet npm publisher. socket-skills
 *   is private and its `build` step refreshes the agent/plugin manifests
 *   consumed directly from this repository. Usage: node
 *   scripts/repo/publish.mts Regenerate all artifacts. node
 *   scripts/repo/publish.mts --check Regenerate, then fail if tracked output
 *   changed.
 */

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
const tsxCliPath = fileURLToPath(import.meta.resolve('tsx/cli'))

const GENERATED_FILES = [
  'agents/AGENTS.md',
  'README.md',
  '.cursor-plugin/plugin.json',
  '.mcp.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'gemini-extension.json',
] as const

const GENERATORS = [
  'scripts/repo/inline-shared.mts',
  'scripts/repo/sync-versions.mts',
  'scripts/repo/generate-agents.mts',
  'scripts/repo/generate-cursor-plugin.mts',
] as const

const MISSING = '__MISSING__'

function fileSignature(relativePath: string): string {
  try {
    return crypto
      .createHash('sha256')
      .update(readFileSync(path.join(rootPath, relativePath)))
      .digest('hex')
  } catch {
    return MISSING
  }
}

async function runScript(scriptPath: string, ...args: string[]): Promise<void> {
  const result = await spawn(
    process.execPath,
    [tsxCliPath, scriptPath, ...args],
    {
      cwd: rootPath,
      stdio: 'inherit',
    },
  )
  if (result.code) {
    throw new Error(`${scriptPath} exited with code ${result.code}`)
  }
}

async function generate(): Promise<void> {
  for (let i = 0, { length } = GENERATORS; i < length; i += 1) {
    await runScript(GENERATORS[i]!)
  }
  // Generated Markdown tables and JSON must be byte-identical to the normal
  // repository formatter output; otherwise `build` and `format` fight and the
  // subsequent `generate:check` reports drift on a clean checkout.
  await runScript('scripts/fleet/format.mts', ...GENERATED_FILES, 'skills')
}

async function check(): Promise<void> {
  const before = new Map<string, string>()
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const relativePath = GENERATED_FILES[i]!
    before.set(relativePath, fileSignature(relativePath))
  }

  await generate()

  const changed: string[] = []
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const relativePath = GENERATED_FILES[i]!
    if (fileSignature(relativePath) !== before.get(relativePath)) {
      changed.push(relativePath)
    }
  }

  if (changed.length > 0) {
    process.stderr.write(
      `Generated artifacts are outdated. Run \`pnpm run generate\`.\n\nChanged files:\n${changed.map(file => `  ${file}`).join('\n')}\n`,
    )
    process.exitCode = 1
    return
  }

  await runScript('scripts/repo/generate-cursor-plugin.mts', '--check')
  await runScript('scripts/repo/inline-shared.mts', '--check')
  process.stdout.write('All generated artifacts are up to date.\n')
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [arg] = args
  if (arg === undefined) {
    await generate()
    process.stdout.write('Publish artifacts generated successfully.\n')
  } else if (arg === '--check') {
    await check()
  } else if (arg === '--help' || arg === '-h') {
    process.stdout.write(
      'Usage: node scripts/repo/publish.mts [--check]\n' +
        'Generates the agent, README, and plugin artifacts for socket-skills.\n',
    )
  } else {
    process.stderr.write(`Unknown option: ${arg}\nUse --help for usage.\n`)
    process.exitCode = 2
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
}
