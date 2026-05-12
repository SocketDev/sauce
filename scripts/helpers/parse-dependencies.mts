#!/usr/bin/env pnpm dlx tsx
/**
 * Extract dependencies from manifest files by ecosystem.
 *
 * Usage: pnpm dlx tsx scripts/helpers/parse-dependencies.ts [--ecosystem <name>] [--dir <path>]
 *
 * Outputs JSON: { dependencies: [{ name, version, type, ecosystem }] }
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
  if (!existsSync(gemfilePath)) return []

  const content = readFileSync(gemfilePath, 'utf-8')
  const deps: Dependency[] = []
  let currentGroup = 'default'

  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
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
  if (!existsSync(tomlPath)) return []

  const content = readFileSync(tomlPath, 'utf-8')
  const deps: Dependency[] = []
  let section = ''

  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
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
  if (!existsSync(modPath)) return []

  const content = readFileSync(modPath, 'utf-8')
  const deps: Dependency[] = []
  let inRequire = false

  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
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
  if (!existsSync(pomPath)) return []

  const content = readFileSync(pomPath, 'utf-8')
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
  if (!existsSync(pkgPath)) return []

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const deps: Dependency[] = []

  const prodEntries = Object.entries(pkg.dependencies ?? {})
  for (let i = 0, { length } = prodEntries; i < length; i += 1) {
    const [name, version] = prodEntries[i]
    deps.push({
      name,
      version: String(version),
      type: 'production',
      ecosystem: 'npm',
    })
  }
  const devEntries = Object.entries(pkg.devDependencies ?? {})
  for (let i = 0, { length } = devEntries; i < length; i += 1) {
    const [name, version] = devEntries[i]
    deps.push({ name, version: String(version), type: 'dev', ecosystem: 'npm' })
  }
  const peerEntries = Object.entries(pkg.peerDependencies ?? {})
  for (let i = 0, { length } = peerEntries; i < length; i += 1) {
    const [name, version] = peerEntries[i]
    deps.push({
      name,
      version: String(version),
      type: 'peer',
      ecosystem: 'npm',
    })
  }
  const optionalEntries = Object.entries(pkg.optionalDependencies ?? {})
  for (let i = 0, { length } = optionalEntries; i < length; i += 1) {
    const [name, version] = optionalEntries[i]
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
  const entries = readdirSync(dir)

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    if (entry.endsWith('.csproj')) {
      const content = readFileSync(path.join(dir, entry), 'utf-8')
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
  if (existsSync(reqPath)) {
    const lines = readFileSync(reqPath, 'utf-8').split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]
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
  if (existsSync(devReqPath)) {
    const lines = readFileSync(devReqPath, 'utf-8').split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]
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
      const parsers = Object.values(PARSERS)
      for (let i = 0, { length } = parsers; i < length; i += 1) {
        allDeps.push(...parsers[i](dir))
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
