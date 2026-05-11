import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { validateMarketplace } from '../../scripts/lib/validate-marketplace'

const ROOT = path.resolve(__dirname, '../..')
const SKILLS_DIR = path.join(ROOT, 'skills')
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json')

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

export function getSkillDirs(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .sort()
}

export function loadJSON(relPath: string): unknown {
  const fullPath = path.join(ROOT, relPath)
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
}

describe('Manifest Consistency', () => {
  const marketplace = loadJSON('.claude-plugin/marketplace.json') as Marketplace
  const packageJson = loadJSON('package.json') as {
    version: string
  }
  const geminiJson = loadJSON('gemini-extension.json') as {
    version: string
  }
  const agentsMd = fs.readFileSync(
    path.join(ROOT, 'agents', 'AGENTS.md'),
    'utf-8',
  )

  describe('marketplace.json', () => {
    it('passes shared validation (skills ↔ marketplace sync)', () => {
      const errors = validateMarketplace(SKILLS_DIR, MARKETPLACE_PATH)
      expect(
        errors,
        `Marketplace validation errors:\n${errors.map(e => `  - ${e.message}`).join('\n')}`,
      ).toEqual([])
    })

    it('every plugin source path resolves to a real SKILL.md', () => {
      for (const plugin of marketplace.plugins) {
        const skillMd = path.join(ROOT, plugin.source, 'SKILL.md')
        expect(
          fs.existsSync(skillMd),
          `plugin '${plugin.name}' source '${plugin.source}' has no SKILL.md`,
        ).toBe(true)
      }
    })
  })

  describe('AGENTS.md', () => {
    it('references all skill paths', () => {
      for (const dir of getSkillDirs()) {
        expect(
          agentsMd,
          `AGENTS.md does not reference skills/${dir}/SKILL.md`,
        ).toContain(`skills/${dir}/SKILL.md`)
      }
    })

    it('lists all skill names in the table', () => {
      for (const dir of getSkillDirs()) {
        // Markdown tables pad column values with spaces; match the
        // skill-dir cell with a regex that tolerates the padding.
        const tableRowRe = new RegExp(`\\|\\s*${dir}\\s*\\|`)
        expect(
          tableRowRe.test(agentsMd),
          `AGENTS.md table does not list skill '${dir}'`,
        ).toBe(true)
      }
    })
  })

  describe('Version consistency', () => {
    it('marketplace.json version matches package.json', () => {
      expect(marketplace.metadata.version).toBe(packageJson.version)
    })

    it('gemini-extension.json version matches package.json', () => {
      expect(geminiJson.version).toBe(packageJson.version)
    })

    it('all manifest versions are in sync', () => {
      const pluginJson = loadJSON('.claude-plugin/plugin.json') as {
        version: string
      }
      const cursorJson = loadJSON('.cursor-plugin/plugin.json') as {
        version: string
      }

      const versions = {
        'package.json': packageJson.version,
        'marketplace.json': marketplace.metadata.version,
        'gemini-extension.json': geminiJson.version,
        'plugin.json': pluginJson.version,
        'cursor plugin.json': cursorJson.version,
      }

      const uniqueVersions = [...new Set(Object.values(versions))]
      expect(
        uniqueVersions,
        `Version mismatch across manifests: ${JSON.stringify(versions)}`,
      ).toHaveLength(1)
    })
  })
})
