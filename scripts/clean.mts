#!/usr/bin/env node
/**
 * @fileoverview Clean runner with flag-based configuration.
 *
 * Mirrors the canonical fleet `clean.mts` flag surface (used by
 * socket-packageurl-js, socket-sdk-js, etc.) but stays dep-free:
 * single-package skill marketplaces don't need `del` / `fast-glob`
 * for the small target set here. If this repo grows a real build
 * graph, replace the body with the canonical lib-backed version.
 *
 * Removes build artifacts, coverage, and TypeScript incremental cache.
 *
 * Cross-platform: uses `node:fs`'s recursive `rm` instead of shelling
 * out to `rm -rf`, so it works the same on macOS / Linux / Windows.
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

type Flags = {
  readonly all: boolean
  readonly cache: boolean
  readonly coverage: boolean
  readonly dist: boolean
  readonly help: boolean
  readonly modules: boolean
  readonly quiet: boolean
  readonly types: boolean
}

export function parseFlags(argv: readonly string[]): Flags {
  const has = (flag: string): boolean => argv.includes(flag)
  return {
    all: has('--all'),
    cache: has('--cache'),
    coverage: has('--coverage'),
    dist: has('--dist'),
    help: has('--help') || has('-h'),
    modules: has('--modules'),
    quiet: has('--quiet') || has('--silent'),
    types: has('--types'),
  }
}

export function printHelp(): void {
  process.stdout.write(
    [
      'Clean Runner',
      '',
      'Usage: pnpm clean [options]',
      '',
      'Options:',
      '  --help, -h          Show this help message',
      '  --all               Clean everything (default if no flags)',
      '  --cache             Clean cache directories',
      '  --coverage          Clean coverage reports',
      '  --dist              Clean build output',
      '  --types             Clean TypeScript declarations only',
      '  --modules           Clean node_modules',
      '  --quiet, --silent   Suppress progress messages',
      '',
      'Examples:',
      '  pnpm clean                  # Clean everything except node_modules',
      '  pnpm clean --dist           # Clean build output only',
      '  pnpm clean --cache --coverage  # Clean cache and coverage',
      '  pnpm clean --all --modules  # Clean everything including node_modules',
      '',
    ].join('\n'),
  )
}

export async function removeIfExists(
  rel: string,
  quiet: boolean,
): Promise<void> {
  const full = path.join(rootPath, rel)
  if (!existsSync(full)) {
    if (!quiet) {
      process.stdout.write(`  ${rel}/ already clean\n`)
    }
    return
  }
  await rm(full, { force: true, recursive: true })
  if (!quiet) {
    process.stdout.write(`  removed ${rel}/\n`)
  }
}

export async function removeTsBuildInfo(quiet: boolean): Promise<void> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) {
      const target = path.join(rootPath, entry.name)
      await rm(target, { force: true })
      if (!quiet) {
        process.stdout.write(`  removed ${entry.name}\n`)
      }
    }
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  if (flags.help) {
    printHelp()
    return
  }

  const cleanAll =
    flags.all ||
    (!flags.cache &&
      !flags.coverage &&
      !flags.dist &&
      !flags.types &&
      !flags.modules)

  const tasks: Array<() => Promise<void>> = []

  if (cleanAll || flags.dist) {
    tasks.push(() => removeIfExists('dist', flags.quiet))
    tasks.push(() => removeTsBuildInfo(flags.quiet))
  } else if (flags.types) {
    tasks.push(() => removeIfExists('dist/types', flags.quiet))
  }
  if (cleanAll || flags.coverage) {
    tasks.push(() => removeIfExists('coverage', flags.quiet))
  }
  if (cleanAll || flags.cache) {
    tasks.push(() => removeIfExists('.cache', flags.quiet))
  }
  if (flags.modules) {
    tasks.push(() => removeIfExists('node_modules', flags.quiet))
  }

  if (tasks.length === 0) {
    if (!flags.quiet) {
      process.stdout.write('  Nothing to clean\n')
    }
    return
  }

  if (!flags.quiet) {
    process.stdout.write('Cleaning project directories\n')
  }
  for (const task of tasks) {
    await task()
  }
  if (!flags.quiet) {
    process.stdout.write('  clean complete\n')
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`clean failed: ${(e as Error).message}\n`)
  process.exitCode = 1
})
