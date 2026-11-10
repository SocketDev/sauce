#!/usr/bin/env node
// Nested cached-length for-loops intentionally reuse `i`/`length` names for
// the fleet-wide cached-loop idiom; renaming would diverge from the codebase
// pattern.
/* eslint-disable no-shadow -- cached-loop idiom */
/**
 * Generate agents/README.md — the AGENTS.md-style fallback bundle — from
 * docs/agents-template.md and SKILL.md frontmatter.
 *
 * Also updates the skills table in README.md, grouped by each skill's
 * `metadata.category`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { REPO_ROOT } from './paths.mts'
import { discoverSkills, skillCategory } from './plugins/skills.mts'
import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'

const logger = getDefaultLogger()

const ROOT = REPO_ROOT
const TEMPLATE_PATH = path.join(ROOT, 'docs', 'agents-template.md')
const OUTPUT_PATH = path.join(ROOT, 'agents', 'README.md')
const README_PATH = path.join(ROOT, 'README.md')

const README_TABLE_START = '<!-- BEGIN_SKILLS_TABLE -->'
const README_TABLE_END = '<!-- END_SKILLS_TABLE -->'

export interface Skill {
  name: string
  description: string
  path: string
  category: string
}

interface CategoryDef {
  label: string
  description: string
}

export const CATEGORIES: Array<[string, CategoryDef]> = [
  [
    'setup',
    {
      label: 'Setup',
      description:
        'Install, authenticate, and configure Socket for your project.',
    },
  ],
  [
    'analysis',
    {
      label: 'Analysis',
      description:
        'Scan dependencies and inspect individual packages for security risks.',
    },
  ],
  [
    'fix',
    {
      label: 'Fix',
      description:
        'Holistic dependency repair - orchestrate cleanup, replacement, patching, and upgrades in a single phased workflow with individual subskills for each operation.',
    },
  ],
  [
    'protect',
    {
      label: 'Protect',
      description:
        'Block malicious packages at install time and respond when one gets through.',
    },
  ],
  [
    'reference',
    {
      label: 'Reference',
      description:
        'Current facts about Socket products for the agent to read before giving advice.',
    },
  ],
  [
    'release',
    {
      label: 'Release',
      description:
        'Stand up and operate SocketDev publishing with the socket-release kit.',
    },
  ],
]

/**
 * Every skill, as agents/README.md and the README table list it.
 */
export function loadSkills(root: string = ROOT): Skill[] {
  const known = new Set(CATEGORIES.map(([key]) => key))
  return discoverSkills(root).map(skill => {
    const category = skillCategory(skill)
    if (!category || !known.has(category)) {
      throw new Error(
        `skills/${skill.relDir}/SKILL.md needs metadata.category set to one of: ${[...known].join(', ')}`,
      )
    }
    return {
      name: skill.name,
      description: skill.description,
      path: `skills/${skill.relDir}`,
      category,
    }
  })
}

export function generateReadmeTable(skills: Skill[]): string {
  const grouped = new Map<string, Skill[]>()
  for (let i = 0, { length } = CATEGORIES; i < length; i += 1) {
    const key = CATEGORIES[i]![0]
    grouped.set(key, [])
  }
  for (let i = 0, { length } = skills; i < length; i += 1) {
    const skill = skills[i]!
    grouped.get(skill.category)?.push(skill)
  }

  const lines: string[] = []

  for (let i = 0, { length } = CATEGORIES; i < length; i += 1) {
    const { 0: key, 1: def } = CATEGORIES[i]!
    const catSkills = grouped.get(key)
    if (!catSkills || catSkills.length === 0) {
      continue
    }

    lines.push(`#### ${def.label}`)
    lines.push('')
    lines.push(def.description)
    lines.push('')
    lines.push('| Name | Description | Documentation |')
    lines.push('|------|-------------|---------------|')

    for (let i = 0, { length } = catSkills; i < length; i += 1) {
      const skill = catSkills[i]!
      const docLink = `[SKILL.md](${skill.path}/SKILL.md)`
      lines.push(`| \`${skill.name}\` | ${skill.description} | ${docLink} |`)
    }

    lines.push('')
  }

  // Remove trailing empty line
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.join('\n')
}

export function loadTemplate(): string {
  return readFileSync(TEMPLATE_PATH, 'utf-8')
}

/**
 * The `{{#skills}}` / `{{/skills}}` loop, consuming each marker's WHOLE line.
 * The markers sit inside a markdown table, where the formatter wraps every line
 * in pipes — leaving those pipes in the repeated block emits a stray `| |` row
 * per skill and breaks the rendered table.
 */
const SKILLS_LOOP_RE =
  /^[^\n]*\{\{#skills\}\}[^\n]*\n(?<block>[\s\S]*?)^[^\n]*\{\{\/skills\}\}[^\n]*(?:\n|$)/gm

export function renderAgentsDoc(template: string, skills: Skill[]): string {
  return template.replace(SKILLS_LOOP_RE, (_match, block: string) =>
    skills
      .map(skill =>
        block
          .replace(/\{\{name\}\}/g, () => skill.name)
          .replace(/\{\{description\}\}/g, () => skill.description)
          .replace(/\{\{path\}\}/g, () => skill.path),
      )
      .join(''),
  )
}

export function updateReadme(skills: Skill[]): boolean {
  if (!existsSync(README_PATH)) {
    logger.fail(`Warning: README.md not found at ${README_PATH}`)
    return false
  }

  const content = readFileSync(README_PATH, 'utf-8')
  const startIdx = content.indexOf(README_TABLE_START)
  const endIdx = content.indexOf(README_TABLE_END)

  if (startIdx === -1 || endIdx === -1) {
    logger.fail(
      `Warning: README.md markers not found. Add ${README_TABLE_START} and ` +
        `${README_TABLE_END} to enable table generation.`,
    )
    return false
  }

  if (endIdx < startIdx) {
    logger.fail('Warning: README.md markers are in wrong order.')
    return false
  }

  const table = generateReadmeTable(skills)
  const newContent =
    content.slice(0, startIdx + README_TABLE_START.length) +
    '\n' +
    table +
    '\n' +
    content.slice(endIdx)

  writeFileSync(README_PATH, newContent, 'utf-8')
  return true
}

function main(): void {
  const template = loadTemplate()
  const skills = loadSkills()
  const output = renderAgentsDoc(template, skills)

  const outputDir = path.dirname(OUTPUT_PATH)
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  writeFileSync(OUTPUT_PATH, output, 'utf-8')
  logger.log(
    `Wrote ${path.relative(ROOT, OUTPUT_PATH)} with ${skills.length} skills.`,
  )

  if (updateReadme(skills)) {
    logger.log(`Updated ${path.relative(ROOT, README_PATH)} skills table.`)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'generates agent documentation and the README skills table',
  help: 'Usage: node scripts/repo/generate-agents.mts',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
