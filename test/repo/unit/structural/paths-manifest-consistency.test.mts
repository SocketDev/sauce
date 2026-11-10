import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { REPO_ROOT } from '../../../../scripts/repo/paths.mts'
import { discoverSkills } from '../../../../scripts/repo/plugins/skills.mts'

// Version and MCP-server agreement across every agent manifest is checked
// once, over the plugin registry, in plugins.test.mts.

function loadJSON(relPath: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relPath), 'utf-8'))
}

const skills = discoverSkills(REPO_ROOT)

describe('Manifest Consistency', () => {
  it('keeps the tooling package private and unversioned', () => {
    const packageJson = loadJSON('package.json')
    expect(packageJson['private']).toBe(true)
    expect(packageJson['version']).toBe('0.0.0')
  })

  describe('agents/README.md', () => {
    const agentsMd = readFileSync(
      path.join(REPO_ROOT, 'agents', 'README.md'),
      'utf-8',
    )

    it('links every skill, nested ones too', () => {
      for (const skill of skills) {
        expect(agentsMd, skill.name).toContain(
          `skills/${skill.relDir}/SKILL.md`,
        )
      }
    })

    it('lists every skill name in the table', () => {
      for (const skill of skills) {
        expect(
          new RegExp(`\\|\\s*${skill.name}\\s*\\|`).test(agentsMd),
          `agents/README.md table does not list skill '${skill.name}'`,
        ).toBe(true)
      }
    })
  })

  describe('codex marketplace', () => {
    it('every plugin source holds a Codex manifest with the same name', () => {
      const { plugins } = loadJSON('.agents/plugins/marketplace.json') as {
        plugins: Array<{ name: string; source: { path: string } }>
      }
      expect(plugins.length).toBeGreaterThan(0)
      for (const plugin of plugins) {
        const manifestPath = path.join(
          REPO_ROOT,
          plugin.source.path,
          '.codex-plugin',
          'plugin.json',
        )
        expect(existsSync(manifestPath), plugin.name).toBe(true)
        expect(JSON.parse(readFileSync(manifestPath, 'utf-8')).name).toBe(
          plugin.name,
        )
      }
    })
  })
})
