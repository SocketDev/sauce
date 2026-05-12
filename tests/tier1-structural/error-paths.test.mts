import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { parseFrontmatter } from '../../scripts/lib/frontmatter'
import {
  collectSkills,
  validateMarketplace,
} from '../../scripts/lib/validate-marketplace'
import { safeDeleteSync } from '@socketsecurity/lib/fs'

const ROOT = path.resolve(__dirname, '../..')
const SKILLS_DIR = path.join(ROOT, 'skills')
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json')

describe('Error Paths', () => {
  describe('parseFrontmatter()', () => {
    it('returns empty object for missing --- delimiters', () => {
      const result = parseFrontmatter('no frontmatter here\njust content')
      expect(result).toEqual({})
    })

    it('returns empty object for empty frontmatter', () => {
      const result = parseFrontmatter('---\n---\nsome content')
      expect(result).toEqual({})
    })

    it('returns empty object for single --- delimiter', () => {
      const result = parseFrontmatter('---\nname: test\nno closing')
      expect(result).toEqual({})
    })

    it('returns partial data when name is present but description missing', () => {
      const result = parseFrontmatter('---\nname: test\n---\ncontent')
      expect(result.name).toBe('test')
      expect(result.description).toBeUndefined()
    })

    it('returns partial data when description is present but name missing', () => {
      const result = parseFrontmatter(
        '---\ndescription: a test skill\n---\ncontent',
      )
      expect(result.description).toBe('a test skill')
      expect(result.name).toBeUndefined()
    })

    it('handles malformed YAML (lines without colons)', () => {
      const result = parseFrontmatter(
        '---\nname: test\nthis is not yaml\ndescription: desc\n---',
      )
      expect(result.name).toBe('test')
      expect(result.description).toBe('desc')
    })

    it('handles empty values after colon', () => {
      const result = parseFrontmatter('---\nname:\ndescription: valid\n---')
      // Empty value should not be set
      expect(result.name).toBeUndefined()
      expect(result.description).toBe('valid')
    })
  })

  describe('collectSkills()', () => {
    it('returns empty array for non-existent directory', () => {
      const result = collectSkills('/tmp/nonexistent-dir-12345')
      expect(result).toEqual([])
    })

    it('returns empty array for empty directory', () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-empty-'))
      try {
        const result = collectSkills(tmpDir)
        expect(result).toEqual([])
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('skips directories without SKILL.md', () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-noskill-'))
      try {
        mkdirSync(path.join(tmpDir, 'fake-skill'))
        writeFileSync(
          path.join(tmpDir, 'fake-skill', 'README.md'),
          'not a skill',
        )
        const result = collectSkills(tmpDir)
        expect(result).toEqual([])
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('skips SKILL.md files with no frontmatter', () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-nofm-'))
      try {
        mkdirSync(path.join(tmpDir, 'bad-skill'))
        writeFileSync(
          path.join(tmpDir, 'bad-skill', 'SKILL.md'),
          '# No Frontmatter\nJust content.',
        )
        const result = collectSkills(tmpDir)
        expect(result).toEqual([])
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('skips underscore-prefixed directories', () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-shared-'))
      try {
        mkdirSync(path.join(tmpDir, '_shared'))
        writeFileSync(
          path.join(tmpDir, '_shared', 'SKILL.md'),
          '---\nname: shared\ndescription: a shared component\n---\nContent',
        )
        const result = collectSkills(tmpDir)
        expect(result).toEqual([])
      } finally {
        safeDeleteSync(tmpDir)
      }
    })
  })

  describe('validateMarketplace()', () => {
    it('returns error for missing marketplace.json', () => {
      const errors = validateMarketplace(
        SKILLS_DIR,
        '/tmp/nonexistent-marketplace.json',
      )
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].message).toContain('not found')
    })

    it('returns errors for extra plugin entry', () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-extra-'))
      const tmpMarketplace = path.join(tmpDir, 'marketplace.json')
      try {
        // Create a skill
        mkdirSync(path.join(tmpDir, 'skills', 'real-skill'), {
          recursive: true,
        })
        writeFileSync(
          path.join(tmpDir, 'skills', 'real-skill', 'SKILL.md'),
          '---\nname: real-skill\ndescription: a real skill\n---\nContent',
        )
        // Create marketplace with an extra entry
        writeFileSync(
          tmpMarketplace,
          JSON.stringify({
            name: 'test',
            owner: { name: 'test' },
            metadata: { description: 'test', version: '1.0.0' },
            plugins: [
              {
                name: 'real-skill',
                source: './skills/real-skill',
                skills: './',
                description: 'a real skill',
              },
              {
                name: 'ghost-skill',
                source: './skills/ghost-skill',
                skills: './',
                description: 'does not exist',
              },
            ],
          }),
        )
        const errors = validateMarketplace(
          path.join(tmpDir, 'skills'),
          tmpMarketplace,
        )
        expect(errors.some(e => e.message.includes('ghost-skill'))).toBe(true)
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('returns errors for missing plugin entry', () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-missing-'))
      const tmpMarketplace = path.join(tmpDir, 'marketplace.json')
      try {
        // Create two skills
        mkdirSync(path.join(tmpDir, 'skills', 'skill-a'), {
          recursive: true,
        })
        writeFileSync(
          path.join(tmpDir, 'skills', 'skill-a', 'SKILL.md'),
          '---\nname: skill-a\ndescription: skill a\n---\nContent',
        )
        mkdirSync(path.join(tmpDir, 'skills', 'skill-b'), {
          recursive: true,
        })
        writeFileSync(
          path.join(tmpDir, 'skills', 'skill-b', 'SKILL.md'),
          '---\nname: skill-b\ndescription: skill b\n---\nContent',
        )
        // Marketplace only has one
        writeFileSync(
          tmpMarketplace,
          JSON.stringify({
            name: 'test',
            owner: { name: 'test' },
            metadata: { description: 'test', version: '1.0.0' },
            plugins: [
              {
                name: 'skill-a',
                source: './skills/skill-a',
                skills: './',
                description: 'skill a',
              },
            ],
          }),
        )
        const errors = validateMarketplace(
          path.join(tmpDir, 'skills'),
          tmpMarketplace,
        )
        expect(errors.some(e => e.message.includes('skill-b'))).toBe(true)
      } finally {
        safeDeleteSync(tmpDir)
      }
    })
  })
})
