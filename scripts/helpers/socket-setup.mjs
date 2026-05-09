#!/usr/bin/env node
/**
 * Socket setup helper — portable Node.js script (ESM, no tsx needed).
 *
 * Usage:
 *   node scripts/helpers/socket-setup.mjs <subcommand> [options]
 *
 * Subcommands:
 *   check-prereqs      [--dir <path>]                          Check Node, socket CLI, sfw, socket-patch
 *   generate-config    [--dir <path>] [--tier free|enterprise] Emit a socket.yml template (version: 2)
 *   detect-dockerfiles [--dir <path>]                          Find Dockerfiles and analyze install steps
 *
 * All output is JSON to stdout, errors to stderr.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
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

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

function parseVersion(raw) {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return undefined
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function versionGte(v, major, minor = 0, patch = 0) {
  if (v.major !== major) return v.major > major
  if (v.minor !== minor) return v.minor > minor
  return v.patch >= patch
}

function runCmd(cmd) {
  try {
    return execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 10000,
    }).trim()
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// check-prereqs
// ---------------------------------------------------------------------------

function checkPrereqs(dir) {
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
    if (sfwVersion)
      sfwInfo.version = `${sfwVersion.major}.${sfwVersion.minor}.${sfwVersion.patch}`
  }

  // socket-patch
  const patchRaw =
    runCmd('pnpm dlx @socketsecurity/socket-patch --version 2>/dev/null') ||
    runCmd('socket-patch --version')
  const patchInfo = { installed: !!patchRaw }
  if (patchRaw) {
    const patchVersion = parseVersion(patchRaw)
    if (patchVersion)
      patchInfo.version = `${patchVersion.major}.${patchVersion.minor}.${patchVersion.patch}`
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

function detectPackageManager(dir) {
  try {
    const entries = fs.readdirSync(dir)
    if (entries.includes('pnpm-lock.yaml')) return 'pnpm'
    if (entries.includes('yarn.lock')) return 'yarn'
    if (entries.includes('bun.lockb') || entries.includes('bun.lock'))
      return 'bun'
    if (entries.includes('package-lock.json')) return 'npm'
    if (entries.includes('package.json')) return 'npm'
  } catch {
    // ignore
  }
  return undefined
}

// ---------------------------------------------------------------------------
// generate-config
// ---------------------------------------------------------------------------

function generateConfig(tier) {
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

// ---------------------------------------------------------------------------
// detect-dockerfiles
// ---------------------------------------------------------------------------

const INSTALL_PATTERNS = [
  { re: /\bnpm\s+(ci|install)\b/, ecosystem: 'npm' },
  { re: /\byarn\s+(install)?\b/, ecosystem: 'yarn' },
  { re: /\bpnpm\s+(install|i)\b/, ecosystem: 'pnpm' },
  { re: /\bbun\s+install\b/, ecosystem: 'bun' },
  { re: /\bpip\s+install\b/, ecosystem: 'pip' },
  { re: /\bpip3\s+install\b/, ecosystem: 'pip' },
  { re: /\bbundle\s+install\b/, ecosystem: 'bundler' },
  { re: /\bcargo\s+(build|install)\b/, ecosystem: 'cargo' },
  { re: /\bgo\s+(mod\s+download|install)\b/, ecosystem: 'go' },
]

function detectDockerfiles(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir)
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

  for (const name of dockerfileNames) {
    const filePath = path.join(dir, name)
    let content
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    const installLines = []
    const hasSfw = /\bsfw\b/.test(content)
    const hasPatch = /\bsocket-patch\b/.test(content)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!/^\s*RUN\s/i.test(line)) continue
      const cmd = line.replace(/^\s*RUN\s+/i, '').trim()

      for (const pat of INSTALL_PATTERNS) {
        if (pat.re.test(cmd)) {
          installLines.push({
            line: i + 1,
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
