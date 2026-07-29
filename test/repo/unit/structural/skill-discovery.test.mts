// socket-lint: mirror-exempt — asserts every skill on disk is discoverable through its frontmatter, so the shipped tree is the subject, not a module.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { parseFrontmatter } from '../../../../scripts/repo/lib/frontmatter.mts'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const SKILLS_DIR = path.join(REPO_ROOT, 'skills')

/**
 * Top-level skill directories expected under skills/
 */
const EXPECTED_TOP_LEVEL = [
  'socket-fix',
  'socket-inspect',
  'socket-scan',
  'socket-setup',
]

/**
 * Subskills expected under skills/socket-fix/
 */
const EXPECTED_SUBSKILLS: Record<string, string[]> = {
  'socket-fix': [
    'socket-dep-cleanup',
    'socket-dep-patch',
    'socket-dep-replace',
    'socket-dep-upgrade',
  ],
  'socket-scan': ['socket-scan-setup'],
}

export /** All skill directory paths (top-level as name, subskills as parent/name) */
function getAllSkillPaths(): string[] {
  const paths: string[] = []
  const dirs = getSkillDirs()
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    paths.push(dir)
    const subs = getSubSkillDirs(dir)
    for (let j = 0, sublen = subs.length; j < sublen; j += 1) {
      paths.push(`${dir}/${subs[j]!}`)
    }
  }
  return paths.toSorted()
}

export function getSkillDirs(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .toSorted()
}

export function getSubSkillDirs(parent: string): string[] {
  const parentDir = path.join(SKILLS_DIR, parent)
  if (!existsSync(parentDir)) {
    return []
  }
  return readdirSync(parentDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .toSorted()
}

describe('Skill Discovery', () => {
  it('skills directory exists', () => {
    expect(existsSync(SKILLS_DIR)).toBe(true)
  })

  it('every expected skill directory exists', () => {
    const dirs = getSkillDirs()
    for (let i = 0, { length } = EXPECTED_TOP_LEVEL; i < length; i += 1) {
      const skill = EXPECTED_TOP_LEVEL[i]!
      expect(dirs, `missing skill directory: ${skill}`).toContain(skill)
    }
    const subskillEntries = Object.entries(EXPECTED_SUBSKILLS)
    for (let j = 0, sjlen = subskillEntries.length; j < sjlen; j += 1) {
      const [parent, subs] = subskillEntries[j]!
      const subDirs = getSubSkillDirs(parent)
      for (let i = 0, { length } = subs; i < length; i += 1) {
        const sub = subs[i]!
        expect(
          subDirs,
          `missing subskill directory: ${parent}/${sub}`,
        ).toContain(sub)
      }
    }
  })

  it('every skill directory contains a SKILL.md', () => {
    const skillPaths = getAllSkillPaths()
    for (let i = 0, { length } = skillPaths; i < length; i += 1) {
      const skillPath = skillPaths[i]!
      const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
      expect(existsSync(skillMd), `${skillPath}/SKILL.md does not exist`).toBe(
        true,
      )
    }
  })

  it('every SKILL.md has valid YAML frontmatter with name and description', () => {
    const skillPaths = getAllSkillPaths()
    for (let i = 0, { length } = skillPaths; i < length; i += 1) {
      const skillPath = skillPaths[i]!
      const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
      const content = readFileSync(skillMd, 'utf-8')
      const meta = parseFrontmatter(content)

      expect(
        meta['name'],
        `${skillPath}/SKILL.md missing 'name' in frontmatter`,
      ).toBeTruthy()
      expect(
        meta['description'],
        `${skillPath}/SKILL.md missing 'description' in frontmatter`,
      ).toBeTruthy()
    }
  })

  it('frontmatter name matches the directory name', () => {
    const skillPaths = getAllSkillPaths()
    for (let i = 0, { length } = skillPaths; i < length; i += 1) {
      const skillPath = skillPaths[i]!
      const dirName = path.basename(skillPath)
      const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
      const content = readFileSync(skillMd, 'utf-8')
      const meta = parseFrontmatter(content)

      expect(
        meta['name'],
        `${skillPath}/SKILL.md: frontmatter name '${meta['name']}' does not match directory '${dirName}'`,
      ).toBe(dirName)
    }
  })

  it('no orphan skill directories (dirs without SKILL.md)', () => {
    const orphans = getAllSkillPaths().filter(
      skillPath => !existsSync(path.join(SKILLS_DIR, skillPath, 'SKILL.md')),
    )
    expect(orphans, `orphan directories: ${orphans.join(', ')}`).toEqual([])
  })

  it('no unexpected skill directories', () => {
    const dirs = getSkillDirs()
    const unexpected = dirs.filter(d => !EXPECTED_TOP_LEVEL.includes(d))
    expect(
      unexpected,
      `Unexpected top-level skill directories: ${unexpected.join(', ')}. ` +
        `Update EXPECTED_TOP_LEVEL in this test if intentional.`,
    ).toEqual([])

    const subskillEntries = Object.entries(EXPECTED_SUBSKILLS)
    for (let i = 0, { length } = subskillEntries; i < length; i += 1) {
      const [parent, expectedSubs] = subskillEntries[i]!
      const subDirs = getSubSkillDirs(parent)
      const unexpectedSubs = subDirs.filter(d => !expectedSubs.includes(d))
      expect(
        unexpectedSubs,
        `Unexpected subskill directories under ${parent}: ${unexpectedSubs.join(', ')}. ` +
          `Update EXPECTED_SUBSKILLS in this test if intentional.`,
      ).toEqual([])
    }
  })
})
