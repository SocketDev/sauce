#!/usr/bin/env node
/**
 * Clean runner — removes build artifacts, coverage, and TypeScript
 * incremental-build cache from the repo root.
 *
 * Cross-platform: uses `node:fs`'s recursive `rm` instead of shelling
 * out to `rm -rf`, so it works the same on macOS / Linux / Windows.
 *
 * Usage:
 *   node scripts/clean.mts          # default: dist + coverage + tsbuildinfo
 *   node scripts/clean.mts --all    # also remove node_modules + caches
 */
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const args = process.argv.slice(2)
const all = args.includes('--all')

const targets = ['dist', 'coverage']
if (all) {
  targets.push('node_modules', '.cache')
}

async function removeMatching(): Promise<void> {
  // Walk the root for any *.tsbuildinfo files.
  const entries = await readdir(rootPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) {
      const target = path.join(rootPath, entry.name)
      await rm(target, { force: true })
      process.stdout.write(`  removed ${entry.name}\n`)
    }
  }
}

async function main(): Promise<void> {
  for (const target of targets) {
    const fullPath = path.join(rootPath, target)
    if (existsSync(fullPath)) {
      await rm(fullPath, { force: true, recursive: true })
      process.stdout.write(`  removed ${target}/\n`)
    }
  }
  await removeMatching()
  process.stdout.write('  ✓ clean\n')
}

main().catch((e: unknown) => {
  process.stderr.write(`clean failed: ${(e as Error).message}\n`)
  process.exitCode = 1
})
