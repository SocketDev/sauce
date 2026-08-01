#!/usr/bin/env pnpm dlx tsx
/**
 * Generate Cursor plugin artifacts — .cursor-plugin/plugin.json and
 * .cursor-plugin/mcp.json — from .claude-plugin/plugin.json.
 *
 * The plugin's mcp artifact lives under .cursor-plugin/, never at the repo
 * root: root .mcp.json is the fleet's tracked, hand-populated MCP server
 * inventory that scripts/fleet/mcp-config.mts projects to every client. An
 * earlier revision wrote the empty plugin config over it, silently truncating
 * the inventory. This generator must never write outside .cursor-plugin/.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { parseFrontmatter } from './lib/frontmatter.mts'

const logger = getDefaultLogger()

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

// Manifest-relative reference to the plugin's own mcp config artifact.
const CURSOR_MCP_RELATIVE = '.cursor-plugin/mcp.json'

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export interface GenerateResult {
  manifestPath: string
  mcpPath: string
  outdated: string[]
}

export function buildCursorPluginManifest(
  root: string = ROOT,
): Record<string, unknown> {
  const src = loadJson(path.join(root, '.claude-plugin', 'plugin.json'))

  const name = src['name']
  if (typeof name !== 'string' || !name) {
    throw new Error(".claude-plugin/plugin.json must define a non-empty 'name'")
  }
  validatePluginName(name)

  const skills = collectSkillNames(path.join(root, 'skills'))
  if (skills.length === 0) {
    throw new Error('No skills discovered under skills/*/SKILL.md')
  }

  const manifest: Record<string, unknown> = {
    name,
    skills: 'skills',
    mcpServers: CURSOR_MCP_RELATIVE,
  }

  const optionalKeys = [
    'description',
    'version',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
    'logo',
  ]
  for (let i = 0, { length } = optionalKeys; i < length; i += 1) {
    const key = optionalKeys[i]!
    if (key in src) {
      manifest[key] = src[key]
    }
  }

  return manifest
}

export function buildMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {},
  }
}

export function collectSkillNames(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  const names: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue
    }
    const skillMd = path.join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillMd)) {
      continue
    }

    const meta = parseFrontmatter(readFileSync(skillMd, 'utf-8'))
    const name = meta['name']?.trim()
    if (name) {
      names.push(name)
    }

    // Recurse into subdirectories to discover subskills
    names.push(...collectSkillNames(path.join(dir, entry.name)))
  }

  return names
}

export function generateCursorPlugin(
  root: string,
  config: { check: boolean },
): GenerateResult {
  const { check } = { __proto__: null, ...config } as typeof config

  const manifestPath = path.join(root, '.cursor-plugin', 'plugin.json')
  const mcpPath = path.join(root, CURSOR_MCP_RELATIVE)

  const pluginManifest = renderJson(buildCursorPluginManifest(root))
  const mcpConfig = renderJson(buildMcpConfig())

  const outdated: string[] = []
  if (!writeOrCheck(manifestPath, pluginManifest, { check })) {
    outdated.push(path.relative(root, manifestPath))
  }
  if (!writeOrCheck(mcpPath, mcpConfig, { check })) {
    outdated.push(path.relative(root, mcpPath))
  }

  return { manifestPath, mcpPath, outdated }
}

export function loadJson(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`)
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

export function renderJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2) + '\n'
}

export function validatePluginName(name: string): void {
  if (!PLUGIN_NAME_RE.test(name)) {
    throw new Error(
      `Invalid plugin name in .claude-plugin/plugin.json: '${name}'. ` +
        `Must be lowercase and match ${PLUGIN_NAME_RE.source}`,
    )
  }
}

export function writeOrCheck(
  filePath: string,
  content: string,
  config: { check: boolean },
): boolean {
  const { check } = { __proto__: null, ...config } as typeof config
  let current: string | undefined
  if (existsSync(filePath)) {
    current = readFileSync(filePath, 'utf-8')
  }

  if (current === content) {
    return true
  }

  if (check) {
    return false
  }

  const dir = path.dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content, 'utf-8')
  return true
}

function main(): void {
  const checkMode = process.argv.includes('--check')

  const result = generateCursorPlugin(ROOT, { check: checkMode })

  if (checkMode) {
    if (result.outdated.length > 0) {
      logger.fail('Generated Cursor artifacts are out of date:')
      for (let i = 0, { length } = result.outdated; i < length; i += 1) {
        const item = result.outdated[i]
        logger.fail(`  - ${item}`)
      }
      logger.fail('Run: node scripts/repo/generate-cursor-plugin.mts')
      process.exit(1)
    }

    logger.log('Cursor plugin artifacts are up to date.')
    return
  }

  logger.log(`Wrote ${path.relative(ROOT, result.manifestPath)}`)
  logger.log(`Wrote ${path.relative(ROOT, result.mcpPath)}`)
}

if (isMainModule(import.meta.url)) {
  main()
}
