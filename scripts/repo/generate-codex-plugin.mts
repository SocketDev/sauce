#!/usr/bin/env node
/**
 * Generate OpenAI Codex plugin artifacts from .claude-plugin/plugin.json:
 *
 * - Skills/.codex-plugin/plugin.json — the plugin manifest.
 * - Skills/.codex-plugin/mcp.json — the hosted Socket MCP server. Codex runs
 *   OAuth (dynamic client registration + PKCE) against it, so users sign in
 *   with their Socket account instead of pasting one org's API token.
 * - .agents/plugins/marketplace.json — the repo marketplace Codex reads first.
 *
 * The plugin root is skills/, not the repo root: Codex copies the whole plugin
 * root into its cache on install, and skills/ is the only shipped content Codex
 * needs. The MCP artifact is never named .mcp.json — that name is the fleet's
 * MCP inventory and is gitignored at every depth. This generator must never
 * write outside skills/.codex-plugin/ and .agents/plugins/.
 */

import { existsSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'
import {
  repoClaudePluginPath,
  repoCodexMarketplacePath,
  repoCodexMcpPath,
  repoCodexPluginPath,
} from './paths.mts'
import {
  loadJson,
  SOCKET_MCP_SERVER_NAME,
  SOCKET_MCP_URL,
  validatePluginName,
  writeOrCheck,
} from './generate-cursor-plugin.mts'

// One definition of the hosted server for every agent manifest.
export { SOCKET_MCP_SERVER_NAME, SOCKET_MCP_URL }

const logger = getDefaultLogger()

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

// Plugin-root-relative reference to the plugin's own mcp config artifact.
// Codex ignores manifest paths that do not start with './'.
const CODEX_MCP_RELATIVE = './.codex-plugin/mcp.json'

// Marketplace-root-relative (repo-root-relative) plugin source.
const CODEX_PLUGIN_SOURCE = './skills'

const CATEGORY = 'Developer Tools'

const DISPLAY_NAME = 'Socket'

// The scopes the hosted server advertises in its protected-resource metadata.
// Current Codex discovers them on its own; pinning them keeps older Codex
// builds from requesting the authorization server's full scope list.
export const SOCKET_MCP_SCOPES = [
  'packages:list',
  'alerts:list',
  'threat-feed:list',
] as const

const DEFAULT_PROMPTS = [
  "Scan this project's dependencies with Socket.",
  'Check an npm package with Socket before I add it.',
  'Fix the vulnerable dependencies in this project.',
] as const

export interface CodexPluginOptions {
  root?: string | undefined
}

export interface GenerateCodexResult {
  manifestPath: string
  marketplacePath: string
  mcpPath: string
  outdated: string[]
}

export function buildCodexMarketplace(
  options?: CodexPluginOptions | undefined,
): Record<string, unknown> {
  const { root = ROOT } = {
    __proto__: null,
    ...options,
  } as CodexPluginOptions
  const name = readPluginName(root)
  return {
    name,
    interface: { displayName: DISPLAY_NAME },
    plugins: [
      {
        name,
        source: { source: 'local', path: CODEX_PLUGIN_SOURCE },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: CATEGORY,
      },
    ],
  }
}

export function buildCodexMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      [SOCKET_MCP_SERVER_NAME]: {
        type: 'http',
        url: SOCKET_MCP_URL,
        scopes: [...SOCKET_MCP_SCOPES],
      },
    },
  }
}

export function buildCodexPluginManifest(
  options?: CodexPluginOptions | undefined,
): Record<string, unknown> {
  const { root = ROOT } = {
    __proto__: null,
    ...options,
  } as CodexPluginOptions
  const src = loadJson(repoClaudePluginPath(root))
  const name = readPluginName(root)

  const skillRoots = collectSkillRoots(path.join(root, 'skills'))
  if (skillRoots.length === 0) {
    throw new Error('No skills discovered under skills/*/SKILL.md')
  }

  const manifest: Record<string, unknown> = { name }
  const passthroughKeys = ['version', 'description', 'keywords']
  for (let i = 0, { length } = passthroughKeys; i < length; i += 1) {
    const key = passthroughKeys[i]!
    if (key in src) {
      manifest[key] = src[key]
    }
  }
  manifest['skills'] = skillRoots
  manifest['mcpServers'] = CODEX_MCP_RELATIVE

  const author = src['author']
  const developerName =
    author && typeof author === 'object' && 'name' in author
      ? (author as { name: unknown }).name
      : undefined
  const iface: Record<string, unknown> = {
    displayName: DISPLAY_NAME,
    shortDescription:
      'Scan, inspect, patch, and fix dependencies with Socket security data',
  }
  if (typeof src['description'] === 'string') {
    iface['longDescription'] = src['description']
  }
  if (typeof developerName === 'string') {
    iface['developerName'] = developerName
  }
  iface['category'] = CATEGORY
  iface['capabilities'] = ['Read', 'Write']
  iface['websiteURL'] = 'https://socket.dev'
  iface['defaultPrompt'] = [...DEFAULT_PROMPTS]
  manifest['interface'] = iface

  return manifest
}

/**
 * Top-level skill directories as Codex manifest paths ('./<dir>'). Codex scans
 * each root recursively, so subskills (socket-fix/socket-dep-patch, ...) are
 * found without listing them. The plugin root is skills/ itself, and Codex
 * rejects a bare './' skills path, so the roots are listed explicitly.
 */
export function collectSkillRoots(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) {
    return []
  }
  const roots: string[] = []
  const entries = readdirSync(skillsDir, { withFileTypes: true }).toSorted(
    (a, b) => a.name.localeCompare(b.name),
  )
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (
      !entry.isDirectory() ||
      entry.name.startsWith('_') ||
      entry.name.startsWith('.')
    ) {
      continue
    }
    if (existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
      roots.push(`./${entry.name}`)
    }
  }
  return roots
}

export function generateCodexPlugin(
  root: string,
  config: { check: boolean },
): GenerateCodexResult {
  const { check } = { __proto__: null, ...config } as typeof config

  const manifestPath = repoCodexPluginPath(root)
  const mcpPath = repoCodexMcpPath(root)
  const marketplacePath = repoCodexMarketplacePath(root)

  const artifacts: Array<[string, string]> = [
    [manifestPath, renderFormattedJson(buildCodexPluginManifest({ root }))],
    [mcpPath, renderFormattedJson(buildCodexMcpConfig())],
    [marketplacePath, renderFormattedJson(buildCodexMarketplace({ root }))],
  ]

  const outdated: string[] = []
  for (let i = 0, { length } = artifacts; i < length; i += 1) {
    const { 0: filePath, 1: content } = artifacts[i]!
    if (!writeOrCheck(filePath, content, { check })) {
      outdated.push(path.relative(root, filePath))
    }
  }

  return { manifestPath, marketplacePath, mcpPath, outdated }
}

/**
 * Serialize JSON byte-identically to the repo formatter (oxfmt, printWidth 80):
 * objects always break one key per line; an array of primitives stays on one
 * line when that line, including any trailing comma, fits the width.
 * publish.mts formats generated files after writing them, so any other shape
 * would make this generator's --check report formatted files as stale.
 */
export function renderFormattedJson(data: unknown): string {
  return `${renderValue(data, '', '', '')}\n`
}

const PRINT_WIDTH = 80

function renderValue(
  value: unknown,
  indent: string,
  prefix: string,
  suffix: string,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }
    const primitive = value.every(v => v === null || typeof v !== 'object')
    if (primitive) {
      const inline = `[${value.map(v => JSON.stringify(v)).join(', ')}]`
      if ((indent + prefix + inline + suffix).length <= PRINT_WIDTH) {
        return inline
      }
    }
    const inner = `${indent}  `
    const items = value.map(
      (v, i) =>
        inner + renderValue(v, inner, '', i < value.length - 1 ? ',' : ''),
    )
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return '{}'
    }
    const inner = `${indent}  `
    const lines = entries.map(([key, v], i) => {
      const keyPrefix = `${JSON.stringify(key)}: `
      const comma = i < entries.length - 1 ? ',' : ''
      return inner + keyPrefix + renderValue(v, inner, keyPrefix, comma)
    })
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

function readPluginName(root: string): string {
  const name = loadJson(repoClaudePluginPath(root))['name']
  if (typeof name !== 'string' || !name) {
    throw new Error(".claude-plugin/plugin.json must define a non-empty 'name'")
  }
  validatePluginName(name)
  return name
}

function main(): void {
  const checkMode = process.argv.includes('--check')

  const result = generateCodexPlugin(ROOT, { check: checkMode })

  if (checkMode) {
    if (result.outdated.length > 0) {
      logger.fail('Generated Codex artifacts are out of date:')
      for (let i = 0, { length } = result.outdated; i < length; i += 1) {
        logger.fail(`  - ${result.outdated[i]}`)
      }
      logger.fail('Run: node scripts/repo/generate-codex-plugin.mts')
      process.exit(1)
    }

    logger.log('Codex plugin artifacts are up to date.')
    return
  }

  logger.log(`Wrote ${path.relative(ROOT, result.manifestPath)}`)
  logger.log(`Wrote ${path.relative(ROOT, result.mcpPath)}`)
  logger.log(`Wrote ${path.relative(ROOT, result.marketplacePath)}`)
}

const SCRIPT_META: ScriptMeta = {
  describe: 'generates OpenAI Codex plugin artifacts',
  help: 'Usage: node scripts/repo/generate-codex-plugin.mts [--check]',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}
