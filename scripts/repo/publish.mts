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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const GENERATED_FILES = [
  'agents/README.md',
  'README.md',
  '.cursor-plugin/plugin.json',
  '.cursor-plugin/mcp.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
  'skills/.codex-plugin/plugin.json',
  'skills/.codex-plugin/mcp.json',
  'gemini-extension.json',
] as const

// Generated trees, hashed as a whole so an added, changed, or removed file
// counts as drift.
const GENERATED_DIRS = ['hermes'] as const

const GENERATORS = [
  'scripts/repo/inline-shared.mts',
  'scripts/repo/sync-versions.mts',
  'scripts/repo/generate-agents.mts',
  'scripts/repo/generate-cursor-plugin.mts',
  'scripts/repo/generate-codex-plugin.mts',
  'scripts/repo/generate-hermes-plugin.mts',
] as const

export const MISSING = '__MISSING__'

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

export function treeSignature(
  relativeDir: string,
  root: string = rootPath,
): string {
  const dir = path.join(root, relativeDir)
  if (!existsSync(dir)) {
    return MISSING
  }
  const hash = crypto.createHash('sha256')
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .toSorted()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const rel = entries[i]!
    hash.update(`${rel}\0`)
    hash.update(readFileSync(path.join(dir, ...rel.split('/'))))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function runScript(scriptPath: string, ...args: string[]): Promise<void> {
  const result = await spawn(process.execPath, [scriptPath, ...args], {
    cwd: rootPath,
    stdio: 'inherit',
  })
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
  await runScript(
    'node_modules/oxfmt/bin/oxfmt',
    ...GENERATED_FILES,
    'skills',
    ...GENERATED_DIRS,
  )
}

async function check(): Promise<void> {
  const before = new Map<string, string>()
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const relativePath = GENERATED_FILES[i]!
    before.set(relativePath, fileSignature(relativePath))
  }
  for (let i = 0, { length } = GENERATED_DIRS; i < length; i += 1) {
    const relativeDir = GENERATED_DIRS[i]!
    before.set(relativeDir, treeSignature(relativeDir))
  }

  await generate()

  const changed: string[] = []
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const relativePath = GENERATED_FILES[i]!
    if (fileSignature(relativePath) !== before.get(relativePath)) {
      changed.push(relativePath)
    }
  }
  for (let i = 0, { length } = GENERATED_DIRS; i < length; i += 1) {
    const relativeDir = GENERATED_DIRS[i]!
    if (treeSignature(relativeDir) !== before.get(relativeDir)) {
      changed.push(`${relativeDir}/`)
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
  await runScript('scripts/repo/generate-codex-plugin.mts', '--check')
  await runScript('scripts/repo/generate-hermes-plugin.mts', '--check')
  await runScript('scripts/repo/inline-shared.mts', '--check')
  process.stdout.write('All generated artifacts are up to date.\n')
}

export interface PublishMainOptions {
  args?: string[] | undefined
}

export async function main(
  options?: PublishMainOptions | undefined,
): Promise<void> {
  const { args = process.argv.slice(2) } = {
    __proto__: null,
    ...options,
  } as PublishMainOptions
  const { 0: arg } = args
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

const SCRIPT_META: ScriptMeta = {
  describe: 'generates repository publication artifacts',
  help: 'Usage: node scripts/repo/publish.mts [--check]',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(
    () =>
      main().catch((error: unknown) => {
        process.stderr.write(`${String(error)}\n`)
        process.exitCode = 1
      }),
    SCRIPT_META,
  )
}
