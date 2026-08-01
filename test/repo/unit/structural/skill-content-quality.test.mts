// socket-lint: mirror-exempt — scans every skill SKILL.md against the content-quality rules, so the shipped tree is the subject, not a module.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const SKILLS_DIR = path.join(REPO_ROOT, 'skills')

export function getSkillContent(dir: string): string {
  return readFileSync(path.join(SKILLS_DIR, dir, 'SKILL.md'), 'utf-8')
}

export function getSkillDirs(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .toSorted()
}

/**
 * Strip YAML frontmatter and return only the body content.
 */
export function stripFrontmatter(text: string): string {
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

describe('Skill Content Quality', () => {
  const skills = getSkillDirs()

  for (let i = 0, { length } = skills; i < length; i += 1) {
    const skill = skills[i]!
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
          /## When to Use\s*\n(?<body>[\s\S]*?)(?=\n## |\n---|\s*$)/,
        )
        expect(
          match,
          `${skill}/SKILL.md: could not find content after '## When to Use'`,
        ).toBeTruthy()

        const bullets = match!
          .groups!['body']!.split('\n')
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
