import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { validateMarketplace } from '../../../../scripts/repo/lib/validate-marketplace.mts'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const SKILLS_DIR = path.join(REPO_ROOT, 'skills')
const MARKETPLACE_PATH = path.join(
  REPO_ROOT,
  '.claude-plugin',
  'marketplace.json',
)

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
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .toSorted()
}

export function loadJSON(relPath: string): unknown {
  const fullPath = path.join(REPO_ROOT, relPath)
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

describe('Manifest Consistency', () => {
  /* eslint-disable typescript/no-unsafe-type-assertion -- these manifests are
     the very files under test; the assertions below fail loudly on any
     missing field, which is exactly this suite's job. */
  const marketplace = loadJSON('.claude-plugin/marketplace.json') as Marketplace
  const packageJson = loadJSON('package.json') as {
    version: string
  }
  const geminiJson = loadJSON('gemini-extension.json') as {
    version: string
  }
  /* eslint-enable typescript/no-unsafe-type-assertion */
  const agentsMd = readFileSync(
    path.join(REPO_ROOT, 'agents', 'README.md'),
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
      const plugins = marketplace.plugins
      for (let i = 0, { length } = plugins; i < length; i += 1) {
        const plugin = plugins[i]!
        const skillMd = path.join(REPO_ROOT, plugin.source, 'SKILL.md')
        expect(
          existsSync(skillMd),
          `plugin '${plugin.name}' source '${plugin.source}' has no SKILL.md`,
        ).toBe(true)
      }
    })
  })

  describe('agents/README.md', () => {
    it('references all skill paths', () => {
      const dirs = getSkillDirs()
      for (let i = 0, { length } = dirs; i < length; i += 1) {
        const dir = dirs[i]
        expect(
          agentsMd,
          `agents/README.md does not reference skills/${dir}/SKILL.md`,
        ).toContain(`skills/${dir}/SKILL.md`)
      }
    })

    it('lists all skill names in the table', () => {
      const dirs = getSkillDirs()
      for (let i = 0, { length } = dirs; i < length; i += 1) {
        const dir = dirs[i]
        // Markdown tables pad column values with spaces; match the
        // skill-dir cell with a regex that tolerates the padding.
        const tableRowRe = new RegExp(`\\|\\s*${dir}\\s*\\|`)
        expect(
          tableRowRe.test(agentsMd),
          `agents/README.md table does not list skill '${dir}'`,
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
      /* eslint-disable typescript/no-unsafe-type-assertion -- same rationale
         as the suite-level manifests above. */
      const pluginJson = loadJSON('.claude-plugin/plugin.json') as {
        version: string
      }
      const cursorJson = loadJSON('.cursor-plugin/plugin.json') as {
        version: string
      }
      /* eslint-enable typescript/no-unsafe-type-assertion */

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
