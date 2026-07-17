/**
 * @file Unified check runner — delegates to lint + type +
 *   path-hygiene.
 *   Forwards CLI scope flags to the lint script so `pnpm run check --all`
 *   actually runs a full-scope lint (not the default modified-only scope).
 *   `pnpm type` doesn't accept our scope flags, so it's always a full
 *   check.
 *   Usage:
 *   pnpm run check              # lint in modified scope + full type
 *   check + path-hygiene
 *   pnpm run check --staged     # lint staged + full type + paths
 *   pnpm run check --all        # full lint + full type + paths (CI)
 *   Byte-identical across every fleet repo. Sync-scaffolding flags drift.
 */

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib/process/spawn/child'

const args = process.argv.slice(2)
const forwardedArgs = args.filter(
  a => a === '--all' || a === '--fix' || a === '--quiet' || a === '--staged',
)

const steps: Array<[string, string[]]> = [
  ['node', ['scripts/lint.mts', ...forwardedArgs]],
  ['pnpm', ['exec', 'tsgo', '--noEmit', '-p', 'tsconfig.check.json']],
  // Path-hygiene check (1 path, 1 reference). Mantra-driven gate;
  // see .claude/skills/path-guard/ + .claude/hooks/path-guard/.
  ['node', ['scripts/check-paths.mts', '--quiet']],
]

for (const [cmd, cmdArgs] of steps) {
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exitCode = 1
    break
  }
}
