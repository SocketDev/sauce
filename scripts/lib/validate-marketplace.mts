/**
 * Shared marketplace validation logic.
 *
 * Used by both the generation script and the structural tests to ensure
 * marketplace.json stays in sync with discovered skills.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { parseFrontmatter } from './frontmatter'

export interface ValidationError {
  field: string
  message: string
}

export interface Skill {
  name: string
  description: string
  path: string
}

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

/**
 * Collect all skills from the skills directory, including subskills nested
 * inside a parent skill directory.
 */
export function collectSkills(skillsDir: string, basePath = 'skills'): Skill[] {
  if (!existsSync(skillsDir)) return []

  const skills: Skill[] = []
  const entries = readdirSync(skillsDir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!existsSync(skillMd)) continue

    const meta = parseFrontmatter(readFileSync(skillMd, 'utf-8'))
    if (!meta.name || !meta.description) continue

    const skillPath = `${basePath}/${entry.name}`
    skills.push({
      name: meta.name,
      description: meta.description,
      path: skillPath,
    })

    // Recurse into subdirectories to discover subskills
    const subSkills = collectSkills(path.join(skillsDir, entry.name), skillPath)
    skills.push(...subSkills)
  }

  return skills.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  )
}

/**
 * Validate that marketplace.json is in sync with discovered skills.
 *
 * Returns an array of validation errors. Empty array means valid.
 */
export function validateMarketplace(
  skillsDir: string,
  marketplacePath: string,
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!existsSync(marketplacePath)) {
    errors.push({
      field: 'marketplace.json',
      message: `File not found at ${marketplacePath}`,
    })
    return errors
  }

  const skills = collectSkills(skillsDir)
  const marketplace: Marketplace = JSON.parse(
    readFileSync(marketplacePath, 'utf-8'),
  )
  const plugins = marketplace.plugins

  const skillBySource = new Map<string, Skill>()
  for (let i = 0, { length } = skills; i < length; i += 1) {
    const s = skills[i]
    skillBySource.set(`./${s.path}`, s)
  }

  const pluginBySource = new Map<string, MarketplacePlugin>()
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const p = plugins[i]
    pluginBySource.set(p.source, p)
  }

  // Every skill should have a marketplace entry
  for (let i = 0, { length } = skills; i < length; i += 1) {
    const skill = skills[i]
    const expectedSource = `./${skill.path}`
    const plugin = pluginBySource.get(expectedSource)
    if (!plugin) {
      errors.push({
        field: `skills.${skill.name}`,
        message: `Skill '${skill.name}' at '${skill.path}' is missing from marketplace.json`,
      })
    } else if (plugin.name !== skill.name) {
      errors.push({
        field: `plugins.${plugin.name}`,
        message:
          `Name mismatch at '${expectedSource}': ` +
          `SKILL.md='${skill.name}', marketplace.json='${plugin.name}'`,
      })
    }
  }

  // Every marketplace entry should have a skill
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const plugin = plugins[i]
    if (!skillBySource.has(plugin.source)) {
      errors.push({
        field: `plugins.${plugin.name}`,
        message: `Marketplace plugin '${plugin.name}' at '${plugin.source}' has no SKILL.md`,
      })
    }
  }

  // Check for duplicates
  const names = plugins.map(p => p.name)
  const nameSet = new Set(names)
  if (nameSet.size !== names.length) {
    errors.push({
      field: 'plugins',
      message: 'Duplicate plugin names found in marketplace.json',
    })
  }

  const sources = plugins.map(p => p.source)
  const sourceSet = new Set(sources)
  if (sourceSet.size !== sources.length) {
    errors.push({
      field: 'plugins',
      message: 'Duplicate plugin sources found in marketplace.json',
    })
  }

  return errors
}
