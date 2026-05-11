#!/usr/bin/env pnpm dlx tsx
/**
 * Extract dependencies from manifest files by ecosystem.
 *
 * Usage: pnpm dlx tsx scripts/helpers/parse-dependencies.ts [--ecosystem <name>] [--dir <path>]
 *
 * Outputs JSON: { dependencies: [{ name, version, type, ecosystem }] }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

interface Dependency {
  name: string
  version: string
  type: 'production' | 'dev' | 'peer' | 'optional'
  ecosystem: string
}

export function parseArgs(): { ecosystem?: string; dir: string } {
  const args = process.argv.slice(2)
  let ecosystem: string | undefined
  let dir = '.'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ecosystem' && args[i + 1]) {
      ecosystem = args[++i]
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i]
    }
  }
  return { ecosystem, dir: path.resolve(dir) }
}

export function parseBundler(dir: string): Dependency[] {
  const gemfilePath = path.join(dir, 'Gemfile')
  if (!fs.existsSync(gemfilePath)) return []

  const content = fs.readFileSync(gemfilePath, 'utf-8')
  const deps: Dependency[] = []
  let currentGroup = 'default'

  for (const line of content.split('\n')) {
    const groupMatch = line.match(/group\s+:(\w+)/)
    if (groupMatch) {
      currentGroup = groupMatch[1]
      continue
    }
    if (line.trim() === 'end') {
      currentGroup = 'default'
      continue
    }

    const gemMatch = line.match(
      /gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/,
    )
    if (gemMatch) {
      deps.push({
        name: gemMatch[1],
        version: gemMatch[2] ?? '*',
        type: ['development', 'test'].includes(currentGroup)
          ? 'dev'
          : 'production',
        ecosystem: 'bundler',
      })
    }
  }

  return deps
}

export function parseCargo(dir: string): Dependency[] {
  const tomlPath = path.join(dir, 'Cargo.toml')
  if (!fs.existsSync(tomlPath)) return []

  const content = fs.readFileSync(tomlPath, 'utf-8')
  const deps: Dependency[] = []
  let section = ''

  for (const line of content.split('\n')) {
    const sectionMatch = line.match(/^\[(.+)\]/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }

    if (section === 'dependencies' || section === 'dev-dependencies') {
      const depMatch = line.match(/^(\S+)\s*=\s*"([^"]+)"/)
      if (depMatch) {
        deps.push({
          name: depMatch[1],
          version: depMatch[2],
          type: section === 'dev-dependencies' ? 'dev' : 'production',
          ecosystem: 'cargo',
        })
      }
    }
  }

  return deps
}

export function parseGo(dir: string): Dependency[] {
  const modPath = path.join(dir, 'go.mod')
  if (!fs.existsSync(modPath)) return []

  const content = fs.readFileSync(modPath, 'utf-8')
  const deps: Dependency[] = []
  let inRequire = false

  for (const line of content.split('\n')) {
    if (line.trim() === 'require (') {
      inRequire = true
      continue
    }
    if (line.trim() === ')') {
      inRequire = false
      continue
    }

    if (inRequire) {
      const match = line.trim().match(/^(\S+)\s+(\S+)/)
      if (match) {
        deps.push({
          name: match[1],
          version: match[2],
          type: 'production',
          ecosystem: 'go',
        })
      }
    }

    const singleMatch = line.match(/^require\s+(\S+)\s+(\S+)/)
    if (singleMatch) {
      deps.push({
        name: singleMatch[1],
        version: singleMatch[2],
        type: 'production',
        ecosystem: 'go',
      })
    }
  }

  return deps
}

export function parseMaven(dir: string): Dependency[] {
  const pomPath = path.join(dir, 'pom.xml')
  if (!fs.existsSync(pomPath)) return []

  const content = fs.readFileSync(pomPath, 'utf-8')
  const deps: Dependency[] = []

  const depRegex =
    /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?\s*(?:<scope>([^<]+)<\/scope>)?/g
  let match
  while ((match = depRegex.exec(content)) !== null) {
    const scope = match[4] ?? 'compile'
    deps.push({
      name: `${match[1]}:${match[2]}`,
      version: match[3] ?? 'latest',
      type: scope === 'test' ? 'dev' : 'production',
      ecosystem: 'maven',
    })
  }

  return deps
}

export function parseNpm(dir: string): Dependency[] {
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return []

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const deps: Dependency[] = []

  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    deps.push({
      name,
      version: String(version),
      type: 'production',
      ecosystem: 'npm',
    })
  }
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    deps.push({ name, version: String(version), type: 'dev', ecosystem: 'npm' })
  }
  for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
    deps.push({
      name,
      version: String(version),
      type: 'peer',
      ecosystem: 'npm',
    })
  }
  for (const [name, version] of Object.entries(
    pkg.optionalDependencies ?? {},
  )) {
    deps.push({
      name,
      version: String(version),
      type: 'optional',
      ecosystem: 'npm',
    })
  }

  return deps
}

export function parseNuget(dir: string): Dependency[] {
  const deps: Dependency[] = []
  const entries = fs.readdirSync(dir)

  for (const entry of entries) {
    if (entry.endsWith('.csproj')) {
      const content = fs.readFileSync(path.join(dir, entry), 'utf-8')
      const pkgRegex =
        /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g
      let match
      while ((match = pkgRegex.exec(content)) !== null) {
        deps.push({
          name: match[1],
          version: match[2],
          type: 'production',
          ecosystem: 'nuget',
        })
      }
    }
  }

  return deps
}

export function parsePypi(dir: string): Dependency[] {
  const deps: Dependency[] = []
  const reqPath = path.join(dir, 'requirements.txt')
  if (fs.existsSync(reqPath)) {
    const lines = fs.readFileSync(reqPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-'))
        continue
      const match = trimmed.match(/^([a-zA-Z0-9._-]+)\s*([><=!~]+\s*[\d.]+)?/)
      if (match) {
        deps.push({
          name: match[1],
          version: match[2]?.trim() ?? '*',
          type: 'production',
          ecosystem: 'pypi',
        })
      }
    }
  }

  const devReqPath = path.join(dir, 'requirements-dev.txt')
  if (fs.existsSync(devReqPath)) {
    const lines = fs.readFileSync(devReqPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-'))
        continue
      const match = trimmed.match(/^([a-zA-Z0-9._-]+)\s*([><=!~]+\s*[\d.]+)?/)
      if (match) {
        deps.push({
          name: match[1],
          version: match[2]?.trim() ?? '*',
          type: 'dev',
          ecosystem: 'pypi',
        })
      }
    }
  }

  return deps
}

const PARSERS: Record<string, (dir: string) => Dependency[]> = {
  npm: parseNpm,
  pnpm: parseNpm,
  yarn: parseNpm,
  pypi: parsePypi,
  cargo: parseCargo,
  go: parseGo,
  maven: parseMaven,
  bundler: parseBundler,
  nuget: parseNuget,
}

function main(): void {
  try {
    const { ecosystem, dir } = parseArgs()
    let allDeps: Dependency[] = []

    if (ecosystem) {
      const parser = PARSERS[ecosystem]
      if (!parser) {
        throw new Error(
          `Unknown ecosystem: ${ecosystem}. Supported: ${Object.keys(PARSERS).join(', ')}`,
        )
      }
      allDeps = parser(dir)
    } else {
      for (const parser of Object.values(PARSERS)) {
        allDeps.push(...parser(dir))
      }
    }

    // Deduplicate
    const seen = new Set<string>()
    const unique = allDeps.filter(d => {
      const key = `${d.ecosystem}:${d.name}:${d.version}:${d.type}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    process.stdout.write(
      JSON.stringify({ dependencies: unique }, null, 2) + '\n',
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(JSON.stringify({ error: message }) + '\n')
    process.exit(1)
  }
}

main()
