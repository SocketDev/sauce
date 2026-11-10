// Specs for discoverSkills and the helpers every plugin target uses to read
// skills.

import { describe, expect, it } from 'vitest'

import { symlinkSync } from 'node:fs'
import path from 'node:path'

import {
  discoverSkills,
  findInlineShell,
  skillCategory,
  skillOwnFiles,
  skillRequires,
} from '../../../../scripts/repo/plugins/skills.mts'
import { skillMd, withFixture, writeFile, writeSkill } from './fixture.mts'

describe('discoverSkills', () => {
  it('finds skills at every depth, sorted by name, with their parents', () => {
    withFixture(root => {
      expect(
        discoverSkills(root).map(s => [s.name, s.relDir, s.parent]),
      ).toStrictEqual([
        ['alpha', 'alpha', undefined],
        ['alpha-sub', 'alpha/alpha-sub', 'alpha'],
        ['beta', 'beta', undefined],
        ['socket-connect', 'socket-connect', undefined],
      ])
    })
  })

  it('reads description, metadata, and absolute directories', () => {
    withFixture(root => {
      const alpha = discoverSkills(root).find(s => s.name === 'alpha')!
      expect(alpha.description).toBe('The alpha skill.')
      expect(alpha.dir).toBe(path.join(root, 'skills', 'alpha'))
      expect(alpha.metadata).toStrictEqual({
        category: 'analysis',
        requires: 'socket-connect',
      })
      expect(skillCategory(alpha)).toBe('analysis')
      expect(skillRequires(alpha)).toStrictEqual(['socket-connect'])
    })
  })

  it('splits and trims a comma-separated requires list', () => {
    withFixture(root => {
      writeSkill(root, 'gamma', {
        metadata: { requires: '"alpha , beta,"' },
      })
      const gamma = discoverSkills(root).find(s => s.name === 'gamma')!
      expect(skillRequires(gamma)).toStrictEqual(['alpha', 'beta'])
    })
  })

  it('finds a skill nested below a plain directory', () => {
    withFixture(root => {
      writeSkill(root, 'beta/group/deep')
      const deep = discoverSkills(root).find(s => s.name === 'deep')!
      expect(deep.relDir).toBe('beta/group/deep')
      expect(deep.parent).toBe('beta')
    })
  })

  it('returns nothing when skills/ is missing', () => {
    withFixture(root => {
      expect(discoverSkills(path.join(root, 'nowhere'))).toStrictEqual([])
    })
  })

  it('refuses two skills with the same name', () => {
    withFixture(root => {
      writeSkill(root, 'beta/alpha-sub')
      expect(() => discoverSkills(root)).toThrow(
        /skills\/alpha\/alpha-sub and skills\/beta\/alpha-sub are both named 'alpha-sub'/,
      )
    })
  })

  it('refuses a requires entry that names no skill', () => {
    withFixture(root => {
      writeSkill(root, 'gamma', { metadata: { requires: 'nope' } })
      expect(() => discoverSkills(root)).toThrow(
        /requires 'nope', which is not a skill/,
      )
    })
  })

  it('refuses a SKILL.md that breaks the Agent Skills rules', () => {
    withFixture(root => {
      writeFile(root, 'skills/beta/SKILL.md', skillMd('other'))
      expect(() => discoverSkills(root)).toThrow(
        /skills\/beta\/SKILL.md breaks the Agent Skills rules/,
      )
    })
  })

  it('refuses a symlinked skill directory', () => {
    withFixture(root => {
      symlinkSync(
        path.join(root, 'skills', 'beta'),
        path.join(root, 'skills', 'gamma'),
      )
      expect(() => discoverSkills(root)).toThrow(/symlinks/)
    })
  })

  it('ignores _ and . directories even when they hold a SKILL.md', () => {
    withFixture(root => {
      writeSkill(root, 'alpha/_wip')
      writeSkill(root, 'alpha/.cache')
      const names = discoverSkills(root).map(s => s.name)
      expect(names).not.toContain('_wip')
      expect(names).not.toContain('.cache')
      expect(names).not.toContain('_private')
      expect(names).not.toContain('.hidden')
    })
  })
})

describe('skillOwnFiles', () => {
  it('lists a skill’s files without nested skills or _ and . entries', () => {
    withFixture(root => {
      const alpha = discoverSkills(root).find(s => s.name === 'alpha')!
      expect([...skillOwnFiles(alpha).keys()]).toStrictEqual([
        'SKILL.md',
        'references/notes.md',
      ])
    })
  })

  it('refuses a symlinked file, both in discovery and when listing', () => {
    withFixture(root => {
      const alpha = discoverSkills(root).find(s => s.name === 'alpha')!
      symlinkSync(
        path.join(root, 'skills', 'beta', 'SKILL.md'),
        path.join(root, 'skills', 'alpha', 'link.md'),
      )
      expect(() => skillOwnFiles(alpha)).toThrow(/symlinks/)
      expect(() => discoverSkills(root)).toThrow(/symlinks/)
    })
  })
})

describe('findInlineShell', () => {
  it('finds an inline shell snippet in any Markdown file of a skill', () => {
    withFixture(root => {
      writeFile(root, 'skills/beta/refs/cmd.md', 'Today is !`date`.\n')
      writeFile(root, 'skills/alpha/alpha-sub/x.md', 'Run !`ls -la`\n')
      expect(findInlineShell(discoverSkills(root))).toStrictEqual([
        'skills/alpha/alpha-sub/x.md',
        'skills/beta/refs/cmd.md',
      ])
    })
  })

  it('ignores a lone exclamation mark and non-Markdown files', () => {
    withFixture(root => {
      writeFile(root, 'skills/beta/a.md', 'Negate with `!`\nRun `ls`! Then.\n')
      writeFile(root, 'skills/beta/run.sh', 'echo !`date`\n')
      expect(findInlineShell(discoverSkills(root))).toStrictEqual([])
    })
  })
})
