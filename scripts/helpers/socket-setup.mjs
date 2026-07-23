#!/usr/bin/env node
/**
 * Socket setup helper — portable Node.js script (ESM, no tsx needed).
 *
 * Usage:
 * node scripts/helpers/socket-setup.mjs <subcommand> [options]
 *
 * Subcommands: check-prereqs [--dir <path>] Check Node, socket CLI, sfw,
 * socket-patch generate-config [--dir <path>] [--tier free|enterprise] Emit a
 * socket.yml template (version: 2) detect-dockerfiles [--dir <path>] Find
 * Dockerfiles and analyze install steps.
 *
 * All output is JSON to stdout, errors to stderr.
 */

import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const INSTALL_PATTERNS = [
  { re: /\bnpm\s+(ci|install)\b/, ecosystem: 'npm' },
  { re: /\byarn\s+(install)?\b/, ecosystem: 'yarn' },
  { re: /\bpnpm\s+(i|install)\b/, ecosystem: 'pnpm' },
  { re: /\bbun\s+install\b/, ecosystem: 'bun' },
  { re: /\bpip\s+install\b/, ecosystem: 'pip' },
  { re: /\bpip3\s+install\b/, ecosystem: 'pip' },
  { re: /\bbundle\s+install\b/, ecosystem: 'bundler' },
  { re: /\bcargo\s+(build|install)\b/, ecosystem: 'cargo' },
  // Matches `go install` or `go mod download`.
  { re: /\bgo\s+(install|mod\s+download)\b/, ecosystem: 'go' },
]

export function checkPrereqs(dir) {
  // Node
  const nodeRaw = runCmd('node --version')
  const nodeVersion = nodeRaw ? parseVersion(nodeRaw) : undefined
  const nodeInfo = {
    installed: !!nodeVersion,
    version: nodeVersion
      ? `${nodeVersion.major}.${nodeVersion.minor}.${nodeVersion.patch}`
      : undefined,
    ok: nodeVersion ? versionGte(nodeVersion, 18) : false,
  }

  // Socket CLI
  const socketRaw = runCmd('socket --version')
  const socketVersion = socketRaw ? parseVersion(socketRaw) : undefined
  const socketInfo = {
    installed: !!socketVersion,
    version: socketVersion
      ? `${socketVersion.major}.${socketVersion.minor}.${socketVersion.patch}`
      : undefined,
    ok: socketVersion ? versionGte(socketVersion, 1) : false,
    needsUpdate: socketVersion ? !versionGte(socketVersion, 1) : false,
  }

  // sfw
  const sfwRaw = runCmd('sfw --version')
  const sfwInfo = { installed: !!sfwRaw }
  if (sfwRaw) {
    const sfwVersion = parseVersion(sfwRaw)
    if (sfwVersion) {
      sfwInfo.version = `${sfwVersion.major}.${sfwVersion.minor}.${sfwVersion.patch}`
    }
  }

  // socket-patch
  const patchRaw =
    runCmd('pnpm exec @socketsecurity/socket-patch --version') ||
    runCmd('socket-patch --version')
  const patchInfo = { installed: !!patchRaw }
  if (patchRaw) {
    const patchVersion = parseVersion(patchRaw)
    if (patchVersion) {
      patchInfo.version = `${patchVersion.major}.${patchVersion.minor}.${patchVersion.patch}`
    }
  }

  // Package manager detection
  const packageManager = detectPackageManager(dir)

  return {
    node: nodeInfo,
    socketCli: socketInfo,
    sfw: sfwInfo,
    socketPatch: patchInfo,
    packageManager,
  }
}

export function detectDockerfiles(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return { dockerfiles: [] }
  }

  const dockerfileNames = entries.filter(e => {
    const lower = e.toLowerCase()
    return (
      lower === 'dockerfile' ||
      lower.startsWith('dockerfile.') ||
      lower.endsWith('.dockerfile')
    )
  })

  const dockerfiles = []

  for (let i = 0, { length } = dockerfileNames; i < length; i += 1) {
    const name = dockerfileNames[i]
    const filePath = path.join(dir, name)
    let content
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    const installLines = []
    const hasSfw = /\bsfw\b/.test(content)
    const hasPatch = /\bsocket-patch\b/.test(content)

    for (let li = 0, { length: lineCount } = lines; li < lineCount; li += 1) {
      const line = lines[li]
      if (!/^\s*RUN\s/i.test(line)) {
        continue
      }
      const cmd = line.replace(/^\s*RUN\s+/i, '').trim()

      for (
        let j = 0, { length: patternCount } = INSTALL_PATTERNS;
        j < patternCount;
        j += 1
      ) {
        const pat = INSTALL_PATTERNS[j]
        if (pat.re.test(cmd)) {
          installLines.push({
            line: li + 1,
            command: line.trim(),
            ecosystem: pat.ecosystem,
          })
          break
        }
      }
    }

    dockerfiles.push({
      path: name,
      installLines,
      hasSfw,
      hasPatch,
    })
  }

  return { dockerfiles }
}

export function detectPackageManager(dir) {
  try {
    const entries = readdirSync(dir)
    if (entries.includes('pnpm-lock.yaml')) {
      return 'pnpm'
    }
    if (entries.includes('yarn.lock')) {
      return 'yarn'
    }
    if (entries.includes('bun.lockb') || entries.includes('bun.lock')) {
      return 'bun'
    }
    if (entries.includes('package-lock.json')) {
      return 'npm'
    }
    if (entries.includes('package.json')) {
      return 'npm'
    }
  } catch {
    // ignore
  }
  return undefined
}

export function generateConfig(_tier) {
  const lines = [
    'version: 2',
    'issueRules:',
    '  # CVE severity thresholds',
    '  criticalCVE: error        # Block on critical CVEs',
    '  highCVE: warn              # Warn on high CVEs',
    '  mediumCVE: ignore          # Ignore medium CVEs',
    '',
    '  # Supply-chain alerts',
    '  installScripts: error      # Block packages with install scripts',
    '  networkAccess: warn        # Warn on unexpected network access',
    '  shellAccess: warn          # Warn on shell execution',
    '  filesystemAccess: ignore   # Ignore filesystem access alerts',
    '  envVarsAccess: warn        # Warn on environment variable reads',
    '  obfuscatedCode: error      # Block obfuscated code',
    '',
    '  # Malware',
    '  malware: error             # Always block malware',
    '',
    '  # License compliance',
    '  gplLicense: warn           # Warn on GPL licenses',
    '  noLicense: warn            # Warn on packages with no license',
    '  nonPermissiveLicense: warn # Warn on restrictive licenses',
    '',
    'projectIgnorePaths:',
    '  - "test/**"',
    '  - "tests/**"',
    '  - "examples/**"',
    '  - "docs/**"',
    '  - "__fixtures__/**"',
  ]

  return lines.join('\n') + '\n'
}

export function parseArgs() {
  const argv = process.argv.slice(2)
  const subcommand = argv[0]
  const opts = {
    dir: '.',
    tier: 'free',
    mode: 'both',
    dryRun: false,
    file: undefined,
  }

  for (let i = 1; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dir':
        opts.dir = argv[++i]
        break
      case '--tier':
        opts.tier = argv[++i]
        break
      case '--mode':
        opts.mode = argv[++i]
        break
      case '--dry-run':
        opts.dryRun = true
        break
      default:
        if (!opts.file && !argv[i].startsWith('--')) {
          opts.file = argv[i]
        }
        break
    }
  }

  opts.dir = path.resolve(opts.dir)
  return { subcommand, opts }
}

export function parseVersion(raw) {
  // Matches an X.Y.Z version number — groups 1-3 are the major, minor, and
  // patch numbers.
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) {
    return undefined
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

export function runCmd(cmd) {
  // Callers pass a simple space-separated command (no quoting) — split into
  // argv so this runs array-arg (no shell) rather than through a shell string.
  const [bin, ...args] = cmd.split(' ')
  const result = spawnSync(bin, args, {
    shell: WIN32,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  })
  if (result.status !== 0 || result.error) {
    return undefined
  }
  return result.stdout.trim()
}

export function versionGte(v, major, minor = 0, patch = 0) {
  if (v.major !== major) {
    return v.major > major
  }
  if (v.minor !== minor) {
    return v.minor > minor
  }
  return v.patch >= patch
}

function main() {
  const { subcommand, opts } = parseArgs()

  try {
    switch (subcommand) {
      case 'check-prereqs': {
        const result = checkPrereqs(opts.dir)
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        break
      }
      case 'generate-config': {
        const yaml = generateConfig(opts.tier)
        process.stdout.write(yaml)
        break
      }
      case 'detect-dockerfiles': {
        const result = detectDockerfiles(opts.dir)
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        break
      }
      default:
        process.stderr.write(
          JSON.stringify({
            error: `Unknown subcommand: ${subcommand}`,
            usage:
              'node scripts/helpers/socket-setup.mjs <check-prereqs|generate-config|detect-dockerfiles> [options]',
          }) + '\n',
        )
        process.exit(1)
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message }) + '\n')
    process.exit(1)
  }
}

main()
