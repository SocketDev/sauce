#!/usr/bin/env pnpm dlx tsx
/**
 * Generate Cursor plugin artifacts (.cursor-plugin/plugin.json, .mcp.json)
 * from .claude-plugin/plugin.json.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseFrontmatter } from './lib/frontmatter'

const ROOT = path.resolve(__dirname, '..')
const CLAUDE_PLUGIN_MANIFEST = path.join(ROOT, '.claude-plugin', 'plugin.json')
const CURSOR_PLUGIN_DIR = path.join(ROOT, '.cursor-plugin')
const CURSOR_PLUGIN_MANIFEST = path.join(CURSOR_PLUGIN_DIR, 'plugin.json')
const CURSOR_MCP_CONFIG = path.join(ROOT, '.mcp.json')

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

function loadJson(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function collectSkillNames(dir?: string): string[] {
  const skillsDir = dir ?? path.join(ROOT, 'skills')
  if (!fs.existsSync(skillsDir)) return []

  const names: string[] = []
  for (const entry of fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMd)) continue

    const meta = parseFrontmatter(fs.readFileSync(skillMd, 'utf-8'))
    const name = meta.name?.trim()
    if (name) names.push(name)

    // Recurse into subdirectories to discover subskills
    names.push(...collectSkillNames(path.join(skillsDir, entry.name)))
  }

  return names
}

function validatePluginName(name: string): void {
  if (!PLUGIN_NAME_RE.test(name)) {
    throw new Error(
      `Invalid plugin name in .claude-plugin/plugin.json: '${name}'. ` +
        `Must be lowercase and match ${PLUGIN_NAME_RE.source}`,
    )
  }
}

function buildCursorPluginManifest(): Record<string, unknown> {
  const src = loadJson(CLAUDE_PLUGIN_MANIFEST)

  const name = src.name
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

  for (const key of [
    'description',
    'version',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
    'logo',
  ]) {
    if (key in src) {
      manifest[key] = src[key]
    }
  }

  return manifest
}

function buildMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {},
  }
}

function renderJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2) + '\n'
}

function writeOrCheck(
  filePath: string,
  content: string,
  check: boolean,
): boolean {
  let current: string | null = undefined
  if (fs.existsSync(filePath)) {
    current = fs.readFileSync(filePath, 'utf-8')
  }

  if (current === content) return true

  if (check) return false

  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, content, 'utf-8')
  return true
}

function main(): void {
  const checkMode = process.argv.includes('--check')

  const pluginManifest = renderJson(buildCursorPluginManifest())
  const mcpConfig = renderJson(buildMcpConfig())

  const okPlugin = writeOrCheck(
    CURSOR_PLUGIN_MANIFEST,
    pluginManifest,
    checkMode,
  )
  const okMcp = writeOrCheck(CURSOR_MCP_CONFIG, mcpConfig, checkMode)

  if (checkMode) {
    const outdated: string[] = []
    if (!okPlugin) outdated.push(path.relative(ROOT, CURSOR_PLUGIN_MANIFEST))
    if (!okMcp) outdated.push(path.relative(ROOT, CURSOR_MCP_CONFIG))

    if (outdated.length > 0) {
      logger.fail('Generated Cursor artifacts are out of date:')
      for (const item of outdated) {
        logger.fail(`  - ${item}`)
      }
      logger.fail('Run: pnpm dlx tsx scripts/generate-cursor-plugin.ts')
      process.exit(1)
    }

    logger.log('Cursor plugin artifacts are up to date.')
    return
  }

  logger.log(`Wrote ${path.relative(ROOT, CURSOR_PLUGIN_MANIFEST)}`)
  logger.log(`Wrote ${path.relative(ROOT, CURSOR_MCP_CONFIG)}`)
}

main()
