import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseFrontmatter } from '../../scripts/lib/frontmatter'

const ROOT = path.resolve(__dirname, '../..')
const SKILLS_DIR = path.join(ROOT, 'skills')

/** Top-level skill directories expected under skills/ */
const EXPECTED_TOP_LEVEL = [
  'socket-fix',
  'socket-inspect',
  'socket-scan',
  'socket-setup',
]

/** Subskills expected under skills/socket-fix/ */
const EXPECTED_SUBSKILLS: Record<string, string[]> = {
  'socket-fix': [
    'socket-dep-cleanup',
    'socket-dep-patch',
    'socket-dep-replace',
    'socket-dep-upgrade',
  ],
  'socket-scan': ['socket-scan-setup'],
}

/** All expected skill names (top-level + subskills) */
const EXPECTED_SKILLS = [
  ...EXPECTED_TOP_LEVEL,
  ...Object.values(EXPECTED_SUBSKILLS).flat(),
]

export /** All skill directory paths (top-level as name, subskills as parent/name) */
function getAllSkillPaths(): string[] {
  const paths: string[] = []
  for (const dir of getSkillDirs()) {
    paths.push(dir)
    for (const sub of getSubSkillDirs(dir)) {
      paths.push(`${dir}/${sub}`)
    }
  }
  return paths.sort()
}

export function getSkillDirs(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .sort()
}

export function getSubSkillDirs(parent: string): string[] {
  const parentDir = path.join(SKILLS_DIR, parent)
  if (!fs.existsSync(parentDir)) return []
  return fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .sort()
}

describe('Skill Discovery', () => {
  it('skills directory exists', () => {
    expect(fs.existsSync(SKILLS_DIR)).toBe(true)
  })

  it('every expected skill directory exists', () => {
    const dirs = getSkillDirs()
    for (const skill of EXPECTED_TOP_LEVEL) {
      expect(dirs, `missing skill directory: ${skill}`).toContain(skill)
    }
    for (const [parent, subs] of Object.entries(EXPECTED_SUBSKILLS)) {
      const subDirs = getSubSkillDirs(parent)
      for (const sub of subs) {
        expect(
          subDirs,
          `missing subskill directory: ${parent}/${sub}`,
        ).toContain(sub)
      }
    }
  })

  it('every skill directory contains a SKILL.md', () => {
    for (const skillPath of getAllSkillPaths()) {
      const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
      expect(
        fs.existsSync(skillMd),
        `${skillPath}/SKILL.md does not exist`,
      ).toBe(true)
    }
  })

  it('every SKILL.md has valid YAML frontmatter with name and description', () => {
    for (const skillPath of getAllSkillPaths()) {
      const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
      const content = fs.readFileSync(skillMd, 'utf-8')
      const meta = parseFrontmatter(content)

      expect(
        meta.name,
        `${skillPath}/SKILL.md missing 'name' in frontmatter`,
      ).toBeTruthy()
      expect(
        meta.description,
        `${skillPath}/SKILL.md missing 'description' in frontmatter`,
      ).toBeTruthy()
    }
  })

  it('frontmatter name matches the directory name', () => {
    for (const skillPath of getAllSkillPaths()) {
      const dirName = path.basename(skillPath)
      const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
      const content = fs.readFileSync(skillMd, 'utf-8')
      const meta = parseFrontmatter(content)

      expect(
        meta.name,
        `${skillPath}/SKILL.md: frontmatter name '${meta.name}' does not match directory '${dirName}'`,
      ).toBe(dirName)
    }
  })

  it('no orphan skill directories (dirs without SKILL.md)', () => {
    const orphans = getAllSkillPaths().filter(
      skillPath => !fs.existsSync(path.join(SKILLS_DIR, skillPath, 'SKILL.md')),
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

    for (const [parent, expectedSubs] of Object.entries(EXPECTED_SUBSKILLS)) {
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
