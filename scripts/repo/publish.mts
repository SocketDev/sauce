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

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SHIPPED_INSTRUCTION_DIRS } from './constants/shipped-surfaces.mts'
import { REPO_ROOT } from './paths.mts'
import { MISSING, treeSignature } from './plugins/output.mts'
import {
  generatedDirs,
  generatedFiles,
  SIGN_IN_DOC,
} from './plugins/registry.mts'
import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'

const rootPath = REPO_ROOT

const PLUGINS = 'scripts/repo/plugins/generate.mts'
const OXFMT = 'node_modules/oxfmt/bin/oxfmt'

export const GENERATED_FILES: readonly string[] = [
  'agents/README.md',
  'README.md',
  ...generatedFiles(),
]

// Generated trees, hashed as a whole so an added, changed, or removed file
// counts as drift.
export const GENERATED_DIRS: readonly string[] = generatedDirs()

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
  const result = await spawn(process.execPath, [scriptPath, ...args], {
    cwd: rootPath,
    stdio: 'inherit',
  })
  if (result.code) {
    throw new Error(`${scriptPath} exited with code ${result.code}`)
  }
}

// Skills are formatted before the plugins copy them, so every copy matches
// the repository formatter's output and `format` never fights `generate`.
async function generate(): Promise<void> {
  await runScript(PLUGINS, '--sign-in-only')
  await runScript(OXFMT, SIGN_IN_DOC)
  await runScript('scripts/repo/inline-shared.mts')
  await runScript('scripts/repo/generate-agents.mts')
  await runScript(
    OXFMT,
    'agents/README.md',
    'README.md',
    'skills',
    ...SHIPPED_INSTRUCTION_DIRS,
  )
  await runScript(PLUGINS)
}

async function check(): Promise<void> {
  const before = new Map<string, string>()
  for (let i = 0, { length } = GENERATED_FILES; i < length; i += 1) {
    const relativePath = GENERATED_FILES[i]!
    before.set(relativePath, fileSignature(relativePath))
  }
  for (let i = 0, { length } = GENERATED_DIRS; i < length; i += 1) {
    const relativeDir = GENERATED_DIRS[i]!
    before.set(relativeDir, treeSignature(path.join(rootPath, relativeDir)))
  }

  // Check inlined sections before generate() rewrites them; files outside
  // the generated outputs (such as Cursor rules) are not hashed below.
  await runScript('scripts/repo/inline-shared.mts', '--check')

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
    if (
      treeSignature(path.join(rootPath, relativeDir)) !==
      before.get(relativeDir)
    ) {
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

  await runScript(PLUGINS, '--check')
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
