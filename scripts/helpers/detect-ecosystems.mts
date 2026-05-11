#!/usr/bin/env pnpm dlx tsx
/**
 * Detect project ecosystems by scanning for manifest and lock files.
 *
 * Usage: pnpm dlx tsx scripts/helpers/detect-ecosystems.ts [--dir <path>]
 *
 * Outputs JSON: { ecosystems: [{ name, manifests: [string] }] }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

interface EcosystemMatch {
  name: string
  manifests: string[]
}

const ECOSYSTEM_PATTERNS: Record<string, string[]> = {
  npm: ['package.json', 'package-lock.json'],
  pnpm: ['package.json', 'pnpm-lock.yaml'],
  yarn: ['package.json', 'yarn.lock'],
  pypi: [
    'requirements.txt',
    'requirements-dev.txt',
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    'Pipfile',
  ],
  cargo: ['Cargo.toml', 'Cargo.lock'],
  bundler: ['Gemfile', 'Gemfile.lock'],
  maven: ['pom.xml'],
  nuget: ['*.csproj', 'packages.config'],
  go: ['go.mod', 'go.sum'],
}

export function detectEcosystems(dir: string): EcosystemMatch[] {
  if (!fs.existsSync(dir)) {
    return []
  }

  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }

  const results: EcosystemMatch[] = []

  for (const [ecosystem, patterns] of Object.entries(ECOSYSTEM_PATTERNS)) {
    const found = patterns.filter(pattern =>
      entries.some(entry => matchesPattern(entry, pattern)),
    )

    if (found.length > 0) {
      // Differentiate npm/pnpm/yarn by lock file
      if (ecosystem === 'npm' && !entries.includes('package-lock.json'))
        continue
      if (ecosystem === 'pnpm' && !entries.includes('pnpm-lock.yaml')) continue
      if (ecosystem === 'yarn' && !entries.includes('yarn.lock')) continue

      results.push({
        name: ecosystem,
        manifests: found.map(f => path.join(dir, f)),
      })
    }
  }

  // If package.json exists but no lock file, default to npm
  if (
    entries.includes('package.json') &&
    !results.some(r => ['npm', 'pnpm', 'yarn'].includes(r.name))
  ) {
    results.push({
      name: 'npm',
      manifests: [path.join(dir, 'package.json')],
    })
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.slice(1))
  }
  return filename === pattern
}

export function parseArgs(): { dir: string } {
  const args = process.argv.slice(2)
  let dir = '.'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i]
    }
  }
  return { dir: path.resolve(dir) }
}

function main(): void {
  try {
    const { dir } = parseArgs()
    const ecosystems = detectEcosystems(dir)
    process.stdout.write(JSON.stringify({ ecosystems }, null, 2) + '\n')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(JSON.stringify({ error: message }) + '\n')
    process.exit(1)
  }
}

main()
