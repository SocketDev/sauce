import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const SKILLS_DIR = path.join(ROOT, 'skills')

function getSkillDirs(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .sort()
}

function getSkillContent(dir: string): string {
  return fs.readFileSync(path.join(SKILLS_DIR, dir, 'SKILL.md'), 'utf-8')
}

/** Strip YAML frontmatter and return only the body content. */
function stripFrontmatter(text: string): string {
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

describe('Skill Content Quality', () => {
  const skills = getSkillDirs()

  for (const skill of skills) {
    describe(skill, () => {
      const content = getSkillContent(skill)
      const body = stripFrontmatter(content)

      it('has a "When to Use" section', () => {
        expect(
          /^## When to Use/m.test(body),
          `${skill}/SKILL.md missing '## When to Use' heading`,
        ).toBe(true)
      })

      it('"When to Use" section has bullet points', () => {
        const match = body.match(
          /## When to Use\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/,
        )
        expect(
          match,
          `${skill}/SKILL.md: could not find content after '## When to Use'`,
        ).toBeTruthy()

        const bullets = match![1]
          .split('\n')
          .filter(line => /^\s*- /.test(line))
        expect(
          bullets.length,
          `${skill}/SKILL.md: '## When to Use' section has no bullet points`,
        ).toBeGreaterThanOrEqual(1)
      })

      it('has a "Tips" section', () => {
        expect(
          /^## Tips/m.test(body),
          `${skill}/SKILL.md missing '## Tips' heading`,
        ).toBe(true)
      })

      it('has minimum content length (>= 500 characters)', () => {
        expect(
          body.length,
          `${skill}/SKILL.md body is only ${body.length} characters (minimum 500)`,
        ).toBeGreaterThanOrEqual(500)
      })

      it('has balanced code block fences', () => {
        const fences = body.match(/^```/gm) || []
        expect(
          fences.length % 2,
          `${skill}/SKILL.md has ${fences.length} code fence lines (should be even)`,
        ).toBe(0)
      })
    })
  }
})
