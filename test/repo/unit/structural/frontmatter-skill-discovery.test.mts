import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, it } from 'vitest'

import { parseFrontmatter } from '../../../../scripts/repo/lib/frontmatter.mts'
import { getAllSkillPaths, SKILLS_DIR } from './paths-skill-discovery.test.mts'

it('requires every SKILL.md to have name and description frontmatter', () => {
  const skillPaths = getAllSkillPaths()
  for (let i = 0, { length } = skillPaths; i < length; i += 1) {
    const skillPath = skillPaths[i]!
    const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
    const meta = parseFrontmatter(readFileSync(skillMd, 'utf-8'))
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

it('matches each frontmatter name to its directory name', () => {
  const skillPaths = getAllSkillPaths()
  for (let i = 0, { length } = skillPaths; i < length; i += 1) {
    const skillPath = skillPaths[i]!
    const dirName = path.basename(skillPath)
    const skillMd = path.join(SKILLS_DIR, skillPath, 'SKILL.md')
    const meta = parseFrontmatter(readFileSync(skillMd, 'utf-8'))
    expect(
      meta['name'],
      `${skillPath}/SKILL.md: frontmatter name '${meta['name']}' does not match directory '${dirName}'`,
    ).toBe(dirName)
  }
})
