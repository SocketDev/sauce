#!/usr/bin/env pnpm dlx tsx
/**
 * Generate Cursor plugin artifacts (.cursor-plugin/plugin.json, .mcp.json) from
 * .claude-plugin/plugin.json.
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
import { parseFrontmatter } from './lib/frontmatter.mts'

const logger = getDefaultLogger()

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
const CLAUDE_PLUGIN_MANIFEST = path.join(ROOT, '.claude-plugin', 'plugin.json')
const CURSOR_PLUGIN_DIR = path.join(ROOT, '.cursor-plugin')
const CURSOR_PLUGIN_MANIFEST = path.join(CURSOR_PLUGIN_DIR, 'plugin.json')
const CURSOR_MCP_CONFIG = path.join(ROOT, '.mcp.json')

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export function buildCursorPluginManifest(): Record<string, unknown> {
  const src = loadJson(CLAUDE_PLUGIN_MANIFEST)

  const name = src['name']
  if (typeof name !== 'string' || !name) {
    throw new Error(".claude-plugin/plugin.json must define a non-empty 'name'")
  }
  validatePluginName(name)

  const skills = collectSkillNames()
  if (skills.length === 0) {
    throw new Error('No skills discovered under skills/*/SKILL.md')
  }

  const manifest: Record<string, unknown> = {
    name,
    skills: 'skills',
    mcpServers: '.mcp.json',
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

export function collectSkillNames(dir?: string | undefined): string[] {
  const skillsDir = dir ?? path.join(ROOT, 'skills')
  if (!existsSync(skillsDir)) {
    return []
  }

  const names: string[] = []
  const entries = readdirSync(skillsDir, { withFileTypes: true }).toSorted(
    (a, b) => a.name.localeCompare(b.name),
  )
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue
    }
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!existsSync(skillMd)) {
      continue
    }

    const meta = parseFrontmatter(readFileSync(skillMd, 'utf-8'))
    const name = meta['name']?.trim()
    if (name) {
      names.push(name)
    }

    // Recurse into subdirectories to discover subskills
    names.push(...collectSkillNames(path.join(skillsDir, entry.name)))
  }

  return names
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

  const pluginManifest = renderJson(buildCursorPluginManifest())
  const mcpConfig = renderJson(buildMcpConfig())

  const okPlugin = writeOrCheck(CURSOR_PLUGIN_MANIFEST, pluginManifest, {
    check: checkMode,
  })
  const okMcp = writeOrCheck(CURSOR_MCP_CONFIG, mcpConfig, {
    check: checkMode,
  })

  if (checkMode) {
    const outdated: string[] = []
    if (!okPlugin) {
      outdated.push(path.relative(ROOT, CURSOR_PLUGIN_MANIFEST))
    }
    if (!okMcp) {
      outdated.push(path.relative(ROOT, CURSOR_MCP_CONFIG))
    }

    if (outdated.length > 0) {
      logger.fail('Generated Cursor artifacts are out of date:')
      for (let i = 0, { length } = outdated; i < length; i += 1) {
        const item = outdated[i]
        logger.fail(`  - ${item}`)
      }
      logger.fail('Run: pnpm exec tsx scripts/repo/generate-cursor-plugin.ts')
      process.exit(1)
    }

    logger.log('Cursor plugin artifacts are up to date.')
    return
  }

  logger.log(`Wrote ${path.relative(ROOT, CURSOR_PLUGIN_MANIFEST)}`)
  logger.log(`Wrote ${path.relative(ROOT, CURSOR_MCP_CONFIG)}`)
}

main()
