import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from './paths.mts'
import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'
import { formatScanHits, scanFiles } from './util/scan.mts'

interface CheckStep {
  readonly name: string
  readonly run: () => boolean
}

function runCommand(
  command: string,
  args: readonly string[],
  shell: boolean,
): boolean {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    shell,
    stdio: 'inherit',
  })
  return result.status === 0
}

function runPnpm(args: readonly string[]): boolean {
  return runCommand('pnpm', args, process.platform === 'win32')
}

function runNode(args: readonly string[]): boolean {
  return runCommand(process.execPath, args, false)
}

function scanTrackedFiles(): boolean {
  const listed = spawnSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr)
    return false
  }
  const hits = scanFiles(listed.stdout.split('\0').filter(Boolean))
  if (hits.length > 0) {
    process.stderr.write(
      `Tracked files contain secrets or personal paths:\n${formatScanHits(hits)}\n`,
    )
    return false
  }
  return true
}

export function listRepoChecks(repoRoot: string): string[] {
  return readdirSync(path.join(repoRoot, 'scripts', 'repo', 'check'))
    .filter(name => name.endsWith('.mts'))
    .toSorted()
    .map(name => `scripts/repo/check/${name}`)
}

export const CHECK_STEPS: readonly CheckStep[] = [
  { name: 'format', run: () => runPnpm(['run', 'format:check']) },
  { name: 'lint', run: () => runPnpm(['run', 'lint']) },
  { name: 'type', run: () => runPnpm(['run', 'type']) },
  {
    name: 'paths',
    run: () => runNode(['scripts/repo/check-paths.mts', '--quiet']),
  },
  ...listRepoChecks(REPO_ROOT).map((file): CheckStep => ({
    name: path.basename(file, '.mts'),
    run: () => runNode([file]),
  })),
  {
    name: 'generate',
    run: () => runPnpm(['run', 'generate:check']),
  },
  { name: 'scan', run: scanTrackedFiles },
]

function main(): number {
  const failed: string[] = []
  for (const step of CHECK_STEPS) {
    process.stdout.write(`[check] ${step.name}\n`)
    if (!step.run()) {
      failed.push(step.name)
    }
  }
  if (failed.length > 0) {
    process.stderr.write(`[check] failed: ${failed.join(', ')}\n`)
    return 1
  }
  process.stdout.write('[check] all checks passed\n')
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'runs format, lint, type, path, release-kit, generate, and content checks',
  help: 'Usage: pnpm run check',
}
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
