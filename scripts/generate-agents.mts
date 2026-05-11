#!/usr/bin/env pnpm dlx tsx
/**
 * Generate AGENTS.md from AGENTS_TEMPLATE.md and SKILL.md frontmatter.
 *
 * Also validates that marketplace.json is in sync with discovered skills,
 * and updates the skills table in README.md.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  collectSkills,
  validateMarketplace,
  type Skill,
} from './lib/validate-marketplace'

const ROOT = path.resolve(__dirname, '..')
const TEMPLATE_PATH = path.join(ROOT, 'scripts', 'AGENTS_TEMPLATE.md')
const OUTPUT_PATH = path.join(ROOT, 'agents', 'AGENTS.md')
const SKILLS_DIR = path.join(ROOT, 'skills')
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json')
const README_PATH = path.join(ROOT, 'README.md')

const README_TABLE_START = '<!-- BEGIN_SKILLS_TABLE -->'
const README_TABLE_END = '<!-- END_SKILLS_TABLE -->'

interface MarketplacePlugin {
  name: string
  source: string
  skills: string
  description: string
}

interface Marketplace {
  name: string
  owner: { name: string }
  metadata: { description: string; version: string }
  plugins: MarketplacePlugin[]
}

export function loadTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8')
}

export function render(template: string, skills: Skill[]): string {
  return template.replace(
    /\{\{#skills\}\}([\s\S]*?)\{\{\/skills\}\}/g,
    (_match, block: string) => {
      const trimmed = block.replace(/^\n/, '').replace(/\n$/, '')
      return skills
        .map(skill =>
          trimmed
            .replace(/\{\{name\}\}/g, skill.name)
            .replace(/\{\{description\}\}/g, skill.description)
            .replace(/\{\{path\}\}/g, skill.path),
        )
        .join('\n')
    },
  )
}

export function loadMarketplace(): Marketplace {
  if (!fs.existsSync(MARKETPLACE_PATH)) {
    throw new Error(`marketplace.json not found at ${MARKETPLACE_PATH}`)
  }
  return JSON.parse(fs.readFileSync(MARKETPLACE_PATH, 'utf-8'))
}

interface CategoryDef {
  label: string
  description: string
}

const CATEGORIES: Array<[string, CategoryDef]> = [
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
        'Holistic dependency repair — orchestrate cleanup, replacement, patching, and upgrades in a single phased workflow with individual subskills for each operation.',
    },
  ],
]

export function getCategory(skillName: string): string {
  if (skillName === 'socket-setup') return 'setup'
  if (skillName === 'socket-scan' || skillName === 'socket-inspect')
    return 'analysis'
  if (skillName.startsWith('socket-dep-') || skillName === 'socket-fix')
    return 'fix'
  return 'setup'
}

export function generateReadmeTable(skills: Skill[]): string {
  const marketplace = loadMarketplace()
  const pluginsBySource = new Map<string, MarketplacePlugin>()
  for (const p of marketplace.plugins) {
    pluginsBySource.set(p.source, p)
  }

  const grouped = new Map<string, Skill[]>()
  for (const [key] of CATEGORIES) {
    grouped.set(key, [])
  }
  for (const skill of skills) {
    const cat = getCategory(skill.name)
    grouped.get(cat)?.push(skill)
  }

  const lines: string[] = []

  for (const [key, def] of CATEGORIES) {
    const catSkills = grouped.get(key)
    if (!catSkills || catSkills.length === 0) continue

    lines.push(`#### ${def.label}`)
    lines.push('')
    lines.push(def.description)
    lines.push('')
    lines.push('| Name | Description | Documentation |')
    lines.push('|------|-------------|---------------|')

    for (const skill of catSkills) {
      const source = `./${skill.path}`
      const plugin = pluginsBySource.get(source)
      const name = plugin?.name ?? skill.name
      const description = plugin?.description ?? skill.description
      const docLink = `[SKILL.md](${skill.path}/SKILL.md)`
      lines.push(`| \`${name}\` | ${description} | ${docLink} |`)
    }

    lines.push('')
  }

  // Remove trailing empty line
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.join('\n')
}

export function updateReadme(skills: Skill[]): boolean {
  if (!fs.existsSync(README_PATH)) {
    logger.fail(`Warning: README.md not found at ${README_PATH}`)
    return false
  }

  const content = fs.readFileSync(README_PATH, 'utf-8')
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

  fs.writeFileSync(README_PATH, newContent, 'utf-8')
  return true
}

function main(): void {
  const template = loadTemplate()
  const skills = collectSkills(SKILLS_DIR)
  const output = render(template, skills)

  const outputDir = path.dirname(OUTPUT_PATH)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8')
  logger.log(
    `Wrote ${path.relative(ROOT, OUTPUT_PATH)} with ${skills.length} skills.`,
  )

  const errors = validateMarketplace(SKILLS_DIR, MARKETPLACE_PATH)
  if (errors.length > 0) {
    logger.fail('\nMarketplace.json validation errors:')
    for (const error of errors) {
      logger.fail(`  - ${error.message}`)
    }
    process.exit(1)
  }
  logger.log('Marketplace.json validation passed.')

  if (updateReadme(skills)) {
    logger.log(`Updated ${path.relative(ROOT, README_PATH)} skills table.`)
  }
}

main()
