#!/usr/bin/env pnpm dlx tsx
/**
 * Search the codebase for import/require patterns of a specific package.
 *
 * Usage: pnpm dlx tsx scripts/helpers/search-usage.ts --package <name> [--ecosystem <eco>] [--dir <path>]
 *
 * Outputs JSON: { package, found: boolean, files: [{ path, line, match }] }
 */

import { readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import * as path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

interface UsageMatch {
  path: string
  line: number
  match: string
}

const SKIP_DIRS = new Set([
  '__pycache__',
  '.git',
  '.next',
  '.venv',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'target',
  'vendor',
  'venv',
])

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cs',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.py',
  '.pyi',
  '.rb',
  '.rs',
  '.ts',
  '.tsx',
])

export function getPatterns(pkg: string, ecosystem?: string): RegExp[] {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns: RegExp[] = []

  if (!ecosystem || ['npm', 'pnpm', 'yarn'].includes(ecosystem)) {
    patterns.push(
      new RegExp(
        `require\\s*\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\)`,
        'g',
      ),
      new RegExp(`from\\s+['"]${escaped}(?:/[^'"]*)?['"]`, 'g'),
      new RegExp(`import\\s+['"]${escaped}(?:/[^'"]*)?['"]`, 'g'),
      new RegExp(`import\\s*\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\)`, 'g'),
    )
  }
  if (!ecosystem || ecosystem === 'pypi') {
    patterns.push(
      new RegExp(`^import\\s+${escaped}`, 'gm'),
      new RegExp(`^from\\s+${escaped}\\s+import`, 'gm'),
    )
  }
  if (!ecosystem || ecosystem === 'cargo') {
    const crateIdent = escaped.replace(/-/g, '_')
    patterns.push(
      new RegExp(`use\\s+${crateIdent}::`, 'g'),
      new RegExp(`extern\\s+crate\\s+${crateIdent}`, 'g'),
    )
  }
  if (!ecosystem || ecosystem === 'go') {
    patterns.push(new RegExp(`"${escaped}"`, 'g'))
  }
  if (!ecosystem || ecosystem === 'maven') {
    const parts = pkg.split(':')
    if (parts.length >= 2) {
      const groupEscaped = parts[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      patterns.push(new RegExp(`import\\s+${groupEscaped}\\.`, 'g'))
    }
  }
  if (!ecosystem || ecosystem === 'bundler') {
    patterns.push(new RegExp(`require\\s+['"]${escaped}['"]`, 'g'))
  }
  if (!ecosystem || ecosystem === 'nuget') {
    patterns.push(new RegExp(`using\\s+${escaped}`, 'g'))
  }

  return patterns
}

export function parseArgs(): {
  pkg: string
  ecosystem?: string | undefined
  dir: string
} {
  const args = process.argv.slice(2)
  let pkg = ''
  let ecosystem: string | undefined
  let dir = '.'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--package' && args[i + 1]) {
      pkg = args[++i]!
    } else if (args[i] === '--ecosystem' && args[i + 1]) {
      ecosystem = args[++i]!
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i]!
    }
  }
  if (!pkg) {
    throw new Error('--package is required')
  }
  return {
    pkg,
    ...(ecosystem !== undefined && { ecosystem }),
    dir: path.resolve(dir),
  }
}

export function walkDir(
  dir: string,
  callback: (filePath: string) => void,
): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (SKIP_DIRS.has(entry.name)) {
      continue
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDir(fullPath, callback)
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      callback(fullPath)
    }
  }
}

function main(): void {
  try {
    const { pkg, ecosystem, dir } = parseArgs()
    const patterns = getPatterns(pkg, ecosystem)
    const matches: UsageMatch[] = []

    walkDir(dir, filePath => {
      let content: string
      try {
        content = readFileSync(filePath, 'utf-8')
      } catch {
        return
      }

      const lines = content.split('\n')
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!
        for (let pi = 0, { length } = patterns; pi < length; pi += 1) {
          const pattern = patterns[pi]!
          pattern.lastIndex = 0
          const m = pattern.exec(line)
          if (m) {
            matches.push({
              path: path.relative(dir, filePath),
              line: lineIdx + 1,
              match: m[0],
            })
          }
        }
      }
    })

    process.stdout.write(
      JSON.stringify(
        { package: pkg, found: matches.length > 0, files: matches },
        null,
        2,
      ) + '\n',
    )
  } catch (err: unknown) {
    process.stderr.write(JSON.stringify({ error: errorMessage(err) }) + '\n')
    process.exit(1)
  }
}

main()
