#!/usr/bin/env node
/**
 * Generate the Hermes Agent plugin under hermes/ from skills/ and
 * .claude-plugin/plugin.json:
 *
 * - Hermes/plugin.json — an Agent Plugins v1 manifest.
 * - Hermes/skills/<name>/ — a byte-for-byte copy of every skill directory under
 *   skills/, at any depth, named by its frontmatter `name`.
 *
 * Hermes loads only skills/<name>/SKILL.md, one level deep, so nested skills
 * (socket-fix/socket-dep-patch, ...) are flattened into their own top-level
 * directories and left out of their parent's copy.
 *
 * Hermes installs a plugin by cloning its directory and scanning every file in
 * it, with a file-count and size cap, so the plugin lives in its own small
 * directory instead of the repo root. Hermes rejects skill symlinks that leave
 * the plugin root, so the skills are copied, not linked.
 *
 * The plugin ships no mcp.json. An Agent Plugins v1 remote server entry
 * accepts only type, url and headers, so it cannot turn on OAuth, and the
 * hosted Socket MCP server needs OAuth. The socket-connect skill and
 * hermes/README.md tell users to add the server with `hermes mcp add socket
 * --url https://mcp.socket.dev/ --auth oauth`.
 *
 * Hermes/README.md is hand-maintained. This generator writes only
 * hermes/plugin.json and hermes/skills/, removes files under hermes/skills/
 * that no longer exist in skills/, and reports any other entry in hermes/
 * without deleting it.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'
import {
  repoClaudePluginPath,
  repoHermesPluginDir,
  repoHermesPluginManifestPath,
  repoHermesReadmePath,
  repoHermesSkillsDir,
} from './paths.mts'
import { loadJson, SOCKET_MCP_URL } from './generate-cursor-plugin.mts'
import { renderFormattedJson } from './generate-codex-plugin.mts'

const logger = getDefaultLogger()

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

export const AGENT_PLUGINS_SCHEMA_V1 =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'

// Hermes names the install directory and every skill after this name, so
// skills show up as socket:socket-scan, socket:socket-inspect, and so on.
export const HERMES_PLUGIN_NAME = 'socket'

export const HERMES_PLUGIN_SUBDIR = 'hermes'

// The Hermes MCP server name the skills and README tell users to add. Hermes
// exposes its tools as mcp__socket__<tool>, the same names as the Codex and
// Gemini configs.
export const HERMES_MCP_SERVER_NAME = 'socket'

export const HERMES_MCP_ADD_COMMAND = `hermes mcp add ${HERMES_MCP_SERVER_NAME} --url ${SOCKET_MCP_URL} --auth oauth`

// The entries hermes/ may hold. Anything else is reported as drift.
export const HERMES_PLUGIN_ENTRIES = ['README.md', 'plugin.json', 'skills']

// Agent Plugins v1 rules, as Hermes's loader enforces them.
const PLUGIN_NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const SKILL_NAME_RE = /^(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_COMPATIBILITY_LENGTH = 500

// Hermes's install scanner refuses a plugin over these caps.
export const HERMES_MAX_FILE_COUNT = 400
export const HERMES_MAX_TOTAL_BYTES = 10 * 1024 * 1024
export const HERMES_MAX_FILE_BYTES = 1024 * 1024

// Hermes runs !`cmd` snippets in a skill when skills.inline_shell is on.
export const INLINE_SHELL_RE = /!`[^`\n]+`/

export interface HermesPluginOptions {
  root?: string | undefined
}

export interface HermesSkill {
  name: string
  sourceDir: string
}

export interface GenerateHermesResult {
  manifestPath: string
  skillsDir: string
  outdated: string[]
  removed: string[]
}

export interface ValidateHermesOptions {
  extraBytes?: number | undefined
  extraFiles?: number | undefined
}

export function buildHermesPluginManifest(
  options?: HermesPluginOptions | undefined,
): Record<string, unknown> {
  const { root = ROOT } = {
    __proto__: null,
    ...options,
  } as HermesPluginOptions
  const src = loadJson(repoClaudePluginPath(root))

  const manifest: Record<string, unknown> = {
    $schema: AGENT_PLUGINS_SCHEMA_V1,
    name: HERMES_PLUGIN_NAME,
  }
  for (const key of ['version', 'description'] as const) {
    if (typeof src[key] === 'string') {
      manifest[key] = src[key]
    }
  }
  const author = src['author']
  if (author && typeof author === 'object') {
    const authorName = (author as Record<string, unknown>)['name']
    if (typeof authorName === 'string') {
      manifest['author'] = { name: authorName, url: 'https://socket.dev' }
    }
  }
  if (typeof src['homepage'] === 'string') {
    manifest['homepage'] =
      `${src['homepage'].replace(/\/+$/, '')}/tree/main/${HERMES_PLUGIN_SUBDIR}`
  }
  for (const key of ['repository', 'license'] as const) {
    if (typeof src[key] === 'string') {
      manifest[key] = src[key]
    }
  }
  const keywords = src['keywords']
  if (Array.isArray(keywords)) {
    const strings = keywords.filter((k): k is string => typeof k === 'string')
    manifest['keywords'] = strings.includes('hermes')
      ? strings
      : [...strings, 'hermes']
  }
  return manifest
}

/**
 * Every skill directory under skills/, at any depth, keyed by the directory
 * name Hermes will load it from. '_' and '.' entries are skipped at every
 * depth. A symlink anywhere is refused.
 */
export function collectHermesSkills(
  options?: HermesPluginOptions | undefined,
): HermesSkill[] {
  const { root = ROOT } = {
    __proto__: null,
    ...options,
  } as HermesPluginOptions
  const skillsDir = path.join(root, 'skills')
  const skills: HermesSkill[] = []
  if (existsSync(skillsDir)) {
    findSkills(skillsDir, skills)
  }
  const seen = new Map<string, string>()
  for (const skill of skills) {
    const prior = seen.get(skill.name)
    if (prior) {
      throw new Error(
        `Two skills flatten to the same Hermes directory '${skill.name}'.\n` +
          `  Where: ${prior}\n` +
          `         ${skill.sourceDir}\n` +
          `  Fix:   give one of them a different directory name.`,
      )
    }
    seen.set(skill.name, skill.sourceDir)
  }
  return skills.toSorted((a, b) => compareNames(a.name, b.name))
}

/**
 * Every file the generated hermes/skills/ must contain, keyed by its path
 * relative to hermes/skills/ (always '/'-separated), with the source path as
 * the value. Nested skill directories belong to their own entry, not their
 * parent's.
 */
export function collectHermesSkillFiles(
  options?: HermesPluginOptions | undefined,
): Map<string, string> {
  const files = new Map<string, string>()
  for (const skill of collectHermesSkills(options)) {
    walkSkillFiles(skill.sourceDir, skill.name, files)
  }
  return files
}

/**
 * Check a generated plugin against what Hermes accepts. Returns one message
 * per problem; an empty list means Hermes will load every skill.
 */
export function validateHermesPlugin(
  manifest: Record<string, unknown>,
  files: Map<string, string>,
  options?: ValidateHermesOptions | undefined,
): string[] {
  const { extraBytes = 0, extraFiles = 2 } = {
    __proto__: null,
    ...options,
  } as ValidateHermesOptions
  const problems: string[] = []
  const name = manifest['name']
  if (
    typeof name !== 'string' ||
    name.length > MAX_NAME_LENGTH ||
    !PLUGIN_NAME_RE.test(name)
  ) {
    problems.push(`plugin name ${JSON.stringify(name)} is not a valid v1 name`)
  }
  if (manifest['$schema'] !== AGENT_PLUGINS_SCHEMA_V1) {
    problems.push('plugin.json must declare the Agent Plugins v1 schema')
  }

  let totalBytes = extraBytes
  let fileCount = extraFiles
  for (const { 0: rel, 1: source } of files) {
    const content = readFileSync(source)
    totalBytes += content.byteLength
    fileCount += 1
    if (content.byteLength > HERMES_MAX_FILE_BYTES) {
      problems.push(
        `skills/${rel} is ${content.byteLength} bytes, over Hermes's 1MB cap`,
      )
    }
    const parts = rel.split('/')
    if (parts.length === 2 && parts[1] === 'SKILL.md') {
      problems.push(
        ...validateSkillMd(parts[0]!, content.toString('utf-8')).map(
          problem => `skills/${rel}: ${problem}`,
        ),
      )
    }
    if (rel.endsWith('.md') && INLINE_SHELL_RE.test(content.toString())) {
      problems.push(
        `skills/${rel} contains an inline !\`command\` snippet, which Hermes runs when skills.inline_shell is on`,
      )
    }
  }
  if (fileCount > HERMES_MAX_FILE_COUNT) {
    problems.push(
      `plugin has ${fileCount} files, over Hermes's ${HERMES_MAX_FILE_COUNT}-file cap`,
    )
  }
  if (totalBytes > HERMES_MAX_TOTAL_BYTES) {
    problems.push(`plugin is ${totalBytes} bytes, over Hermes's 10MB cap`)
  }
  return problems
}

/**
 * Validate SKILL.md frontmatter the way Hermes's loader does. Hermes parses
 * it as YAML; this accepts only the plain-scalar subset whose YAML meaning is
 * unambiguous, and reports anything else rather than guess.
 */
export function validateSkillMd(dirName: string, text: string): string[] {
  const content = text.replace(/^﻿/, '')
  if (!content.startsWith('---')) {
    return ['missing YAML frontmatter']
  }
  const end = /\n---\s*\n/.exec(content.slice(3))
  if (!end) {
    return ['unterminated YAML frontmatter']
  }
  const { fields, problems } = parseStrictFrontmatter(
    content.slice(3, end.index + 3),
  )
  if (problems.length > 0) {
    return problems
  }

  return [
    ...checkSkillName(fields.get('name'), dirName),
    ...checkSkillDescription(fields.get('description')),
    ...checkOptionalSkillFields(fields),
  ]
}

function checkSkillName(name: unknown, dirName: string): string[] {
  if (
    typeof name === 'string' &&
    name === dirName &&
    name.length <= MAX_NAME_LENGTH &&
    SKILL_NAME_RE.test(name)
  ) {
    return []
  }
  return [
    `name ${JSON.stringify(name ?? null)} must equal its directory name '${dirName}' and be a valid skill name`,
  ]
}

function checkSkillDescription(description: unknown): string[] {
  if (
    typeof description === 'string' &&
    description.length >= 1 &&
    description.length <= MAX_DESCRIPTION_LENGTH
  ) {
    return []
  }
  return [
    `description must be a string of 1 to ${MAX_DESCRIPTION_LENGTH} characters`,
  ]
}

function checkOptionalSkillFields(fields: Map<string, unknown>): string[] {
  const problems: string[] = []
  for (const key of ['license', 'allowed-tools']) {
    if (fields.has(key) && typeof fields.get(key) !== 'string') {
      problems.push(`${key} must be a string`)
    }
  }
  if (fields.has('compatibility')) {
    const value = fields.get('compatibility')
    if (
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > MAX_COMPATIBILITY_LENGTH
    ) {
      problems.push(
        `compatibility must be a string of 1 to ${MAX_COMPATIBILITY_LENGTH} characters`,
      )
    }
  }
  if (fields.has('metadata')) {
    problems.push(
      'metadata cannot be checked here; Hermes requires a map of string keys to string values',
    )
  }
  return problems
}

export function generateHermesPlugin(
  root: string,
  config: { check: boolean },
): GenerateHermesResult {
  const { check } = { __proto__: null, ...config } as typeof config

  const pluginDir = repoHermesPluginDir(root)
  const manifestPath = repoHermesPluginManifestPath(root)
  const skillsDir = repoHermesSkillsDir(root)
  const readmePath = repoHermesReadmePath(root)

  if (!existsSync(readmePath)) {
    throw new Error(
      `Hermes plugin README is missing.\n` +
        `  Where: ${path.relative(root, readmePath)}\n` +
        `  Fix:   restore it; it is hand-maintained, not generated.`,
    )
  }

  const manifest = buildHermesPluginManifest({ root })
  const manifestText = renderFormattedJson(manifest)
  const files = collectHermesSkillFiles({ root })
  if (files.size === 0) {
    throw new Error('No skills discovered under skills/**/SKILL.md')
  }
  const problems = validateHermesPlugin(manifest, files, {
    extraBytes: Buffer.byteLength(manifestText) + statSync(readmePath).size,
    extraFiles: 2,
  })
  if (problems.length > 0) {
    throw new Error(
      `Hermes would reject the generated plugin:\n${problems.map(p => `  - ${p}`).join('\n')}`,
    )
  }

  const outdated: string[] = []
  const removed: string[] = []

  for (const entry of readdirSync(pluginDir)) {
    if (!HERMES_PLUGIN_ENTRIES.includes(entry)) {
      outdated.push(path.relative(root, path.join(pluginDir, entry)))
    }
  }

  // Prune before writing: on a case-insensitive filesystem, writing first
  // would reuse a stale entry whose name differs only in case, and the prune
  // would then delete it.
  if (existsSync(skillsDir)) {
    const existing = new Map<string, string>()
    walkFiles(skillsDir, '', existing)
    for (const { 0: rel, 1: target } of existing) {
      if (files.has(rel)) {
        continue
      }
      const relToRoot = path.relative(root, target)
      if (check) {
        outdated.push(relToRoot)
      } else {
        unlinkSync(target)
        removed.push(relToRoot)
      }
    }
  }

  if (!syncFile(manifestPath, Buffer.from(manifestText), undefined, check)) {
    outdated.push(path.relative(root, manifestPath))
  }
  for (const { 0: rel, 1: source } of files) {
    const target = path.join(skillsDir, ...rel.split('/'))
    if (!syncFile(target, readFileSync(source), source, check)) {
      outdated.push(path.relative(root, target))
    }
  }

  if (!check && existsSync(skillsDir)) {
    removeEmptyDirs(skillsDir, skillsDir)
  }

  return { manifestPath, skillsDir, outdated, removed }
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function findSkills(dir: string, out: HermesSkill[]): void {
  for (const entry of sortedEntries(dir)) {
    if (isSkipped(entry.name)) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      throw symlinkError(full)
    }
    if (!entry.isDirectory()) {
      continue
    }
    if (existsSync(path.join(full, 'SKILL.md'))) {
      out.push({ name: entry.name, sourceDir: full })
    }
    findSkills(full, out)
  }
}

function isExecutable(file: string): boolean {
  return (statSync(file).mode & 0o111) !== 0
}

function isSkipped(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.')
}

function removeEmptyDirs(dir: string, keep: string): boolean {
  let empty = true
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!removeEmptyDirs(path.join(dir, entry.name), keep)) {
        empty = false
      }
    } else {
      empty = false
    }
  }
  if (empty && dir !== keep) {
    rmdirSync(dir)
  }
  return empty
}

function sortedEntries(dir: string) {
  return readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
    compareNames(a.name, b.name),
  )
}

function symlinkError(where: string): Error {
  return new Error(
    `Skills must not contain symlinks; Hermes rejects them.\n` +
      `  Where: ${where}`,
  )
}

/**
 * Make `target` hold exactly `content`, with the source's executable bit.
 * Returns true when it already did. In check mode nothing is written.
 */
function syncFile(
  target: string,
  content: Buffer,
  source: string | undefined,
  check: boolean,
): boolean {
  const wantExec = source !== undefined && isExecutable(source)
  const current = existsSync(target) ? readFileSync(target) : undefined
  if (
    current !== undefined &&
    current.equals(content) &&
    isExecutable(target) === wantExec
  ) {
    return true
  }
  if (check) {
    return false
  }
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  if (process.platform !== 'win32') {
    const mode = statSync(target).mode & 0o777
    chmodSync(target, wantExec ? mode | 0o111 : mode & ~0o111)
  }
  return true
}

const PLAIN_SCALAR_RE = /^[^\s'"&*!|>%@`#{}[\],?:-][^\n]*$/
const YAML_NON_STRING_RE =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/

/**
 * Parse top-level `key: value` frontmatter whose values are plain or
 * single-line quoted YAML scalars, folded across indented continuation lines.
 * Anything YAML could read differently (`: ` or ` #` inside a plain scalar,
 * block scalars, nested maps or lists, flow collections, anchors, tags) is
 * reported, never guessed at.
 */
function parseStrictFrontmatter(body: string): {
  fields: Map<string, unknown>
  problems: string[]
} {
  const { raw, problems } = splitFrontmatterLines(body)
  const fields = new Map<string, unknown>()
  for (const { 0: key, 1: parts } of raw) {
    const parsed = parseScalar(key, parts)
    if (typeof parsed === 'object' && parsed !== null && 'problem' in parsed) {
      problems.push(String(parsed.problem))
    } else {
      fields.set(key, parsed)
    }
  }
  return { fields, problems }
}

function splitFrontmatterLines(body: string): {
  raw: Map<string, string[]>
  problems: string[]
} {
  const raw = new Map<string, string[]>()
  const problems: string[] = []
  let current: string[] | undefined
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) {
      if (current && line.trim() === '') {
        current.push('')
      }
      continue
    }
    if (/^\s/.test(line)) {
      if (current) {
        current.push(line.trim())
      } else {
        problems.push(`unexpected indented line: ${JSON.stringify(line)}`)
      }
      continue
    }
    const match = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line)
    if (!match) {
      problems.push(`cannot read frontmatter line ${JSON.stringify(line)}`)
      current = undefined
      continue
    }
    const key = match[1]!
    if (raw.has(key)) {
      problems.push(`duplicate key '${key}'`)
    }
    current = match[2] ? [match[2]] : []
    raw.set(key, current)
  }
  return { raw, problems }
}

function parseScalar(key: string, parts: string[]): unknown {
  while (parts.length > 0 && parts.at(-1) === '') {
    parts.pop()
  }
  if (parts.length === 0) {
    return null
  }
  const first = parts[0]!
  if (parts.length === 1 && /^(['"]).*\1$/.test(first)) {
    return unquote(first)
  }
  if (!PLAIN_SCALAR_RE.test(first)) {
    return {
      problem: `${key}: value ${JSON.stringify(first)} is not a plain YAML scalar; quote it or rephrase`,
    }
  }
  const value = parts
    .map(part => (part === '' ? '\n' : part))
    .join(' ')
    .replace(/ ?\n ?/g, '\n')
  if (/:\s|\s#|:$/.test(value)) {
    return {
      problem: `${key}: an unquoted value must not contain ': ', ' #', or end with ':'`,
    }
  }
  return YAML_NON_STRING_RE.test(value) ? { nonString: value } : value
}

function unquote(quoted: string): string {
  const body = quoted.slice(1, -1)
  return quoted.startsWith("'")
    ? body.replaceAll("''", "'")
    : (JSON.parse(quoted) as string)
}

function walkFiles(dir: string, prefix: string, out: Map<string, string>) {
  for (const entry of sortedEntries(dir)) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) {
      throw symlinkError(full)
    }
    if (entry.isDirectory()) {
      walkFiles(full, rel, out)
    } else if (entry.isFile()) {
      out.set(rel, full)
    }
  }
}

function walkSkillFiles(
  dir: string,
  prefix: string,
  out: Map<string, string>,
): void {
  for (const entry of sortedEntries(dir)) {
    if (isSkipped(entry.name)) {
      continue
    }
    const full = path.join(dir, entry.name)
    const rel = `${prefix}/${entry.name}`
    if (entry.isSymbolicLink()) {
      throw symlinkError(full)
    }
    if (entry.isDirectory()) {
      if (!existsSync(path.join(full, 'SKILL.md'))) {
        walkSkillFiles(full, rel, out)
      }
    } else if (entry.isFile()) {
      out.set(rel, full)
    }
  }
}

function main(): void {
  const checkMode = process.argv.includes('--check')

  const result = generateHermesPlugin(ROOT, { check: checkMode })

  if (checkMode) {
    if (result.outdated.length > 0) {
      logger.fail('Generated Hermes plugin artifacts are out of date:')
      for (const item of result.outdated) {
        logger.fail(`  - ${item}`)
      }
      logger.fail('Run: node scripts/repo/generate-hermes-plugin.mts')
      process.exit(1)
    }
    logger.log('Hermes plugin artifacts are up to date.')
    return
  }

  logger.log(`Wrote ${path.relative(ROOT, result.manifestPath)}`)
  logger.log(`Wrote ${path.relative(ROOT, result.skillsDir)}`)
  for (const item of result.removed) {
    logger.log(`Removed ${item}`)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'generates the Hermes Agent plugin',
  help: 'Usage: node scripts/repo/generate-hermes-plugin.mts [--check]',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}
