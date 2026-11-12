// A throwaway repository that every plugin test builds from: a Claude
// plugin manifest, a skills tree with nested, hidden, and private entries,
// the hand-maintained sources the targets need, and a populated root
// .mcp.json that no generator may touch.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import { PLUGIN_TARGETS } from '../../../../scripts/repo/plugins/registry.mts'
import { SOURCE_MANIFEST } from '../../../../scripts/repo/plugins/socket.mts'

export const ROOT_MCP_JSON = `${JSON.stringify(
  {
    mcpServers: {
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
    },
  },
  null,
  2,
)}\n`

/**
 * What the fixture writes for a hand-maintained target source file.
 */
export function sourcePlaceholder(rel: string): string {
  return `# Fixture source ${rel}\n`
}

export const FIXTURE_MANIFEST = {
  name: 'fixture-skills',
  version: '9.9.9',
  description: 'Fixture skills.',
  author: { name: 'Fixture Co' },
  homepage: 'https://example.com/fixture/',
  repository: 'https://example.com/fixture',
  license: 'MIT',
  keywords: ['alpha', 'beta'],
}

export interface SkillOptions {
  description?: string | undefined
  metadata?: Record<string, string> | undefined
  extra?: string | undefined
}

export function skillMd(name: string, options: SkillOptions = {}): string {
  const { description = `The ${name} skill.`, metadata, extra = '' } = options
  const meta = metadata
    ? `metadata:\n${Object.entries(metadata)
        .map(([k, v]) => `  ${k}: ${v}\n`)
        .join('')}`
    : ''
  return `---\nname: ${name}\ndescription: ${description}\n${extra}${meta}---\n\n# ${name}\n`
}

export function writeFile(
  root: string,
  rel: string,
  content: string | Buffer,
): void {
  const full = path.join(root, ...rel.split('/'))
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function writeSkill(
  root: string,
  relDir: string,
  options: SkillOptions = {},
): void {
  writeFile(
    root,
    `skills/${relDir}/SKILL.md`,
    skillMd(path.posix.basename(relDir), options),
  )
}

export interface FixtureOptions {
  manifest?: Record<string, unknown> | undefined
  /**
   * Target sources to leave out.
   */
  omitSources?: readonly string[] | undefined
}

/**
 * Every hand-maintained source the registered targets declare, other than
 * the plugin manifest the fixture always writes. Instruction directories and
 * extensionless paths are directories.
 */
function writeTargetSources(root: string, omit: readonly string[]): void {
  const dirs = new Set(PLUGIN_TARGETS.flatMap(t => t.instructionDirs ?? []))
  for (const rel of new Set(PLUGIN_TARGETS.flatMap(t => t.sources))) {
    if (rel === SOURCE_MANIFEST || omit.includes(rel)) {
      continue
    }
    if (dirs.has(rel) || !path.posix.basename(rel).includes('.')) {
      writeFile(root, `${rel}/fixture.md`, sourcePlaceholder(rel))
    } else {
      writeFile(root, rel, sourcePlaceholder(rel))
    }
  }
}

export function makeFixture(options: FixtureOptions = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plugin-fixture-'))
  writeFile(
    root,
    '.claude-plugin/plugin.json',
    `${JSON.stringify(options.manifest ?? FIXTURE_MANIFEST, null, 2)}\n`,
  )
  writeSkill(root, 'socket-connect', { metadata: { category: 'setup' } })
  writeSkill(root, 'alpha', {
    metadata: { category: 'analysis', requires: 'socket-connect' },
  })
  writeSkill(root, 'alpha/alpha-sub', { metadata: { category: 'fix' } })
  writeFile(root, 'skills/alpha/alpha-sub/references/sub.md', '# Sub\n')
  writeFile(root, 'skills/alpha/references/notes.md', '# Notes\n')
  writeFile(root, 'skills/alpha/_draft.md', '# Draft\n')
  writeFile(root, 'skills/alpha/.DS_Store', 'junk')
  writeSkill(root, 'beta', { metadata: { category: 'setup' } })
  writeFile(root, 'skills/_shared/docs/x.md', '# Shared\n')
  writeFile(root, 'skills/no-skill-md/README.md', '# none\n')
  writeSkill(root, '.hidden')
  writeSkill(root, '_private')
  writeFile(root, '.mcp.json', ROOT_MCP_JSON)
  writeTargetSources(root, options.omitSources ?? [])
  return root
}

export function withFixture(
  fn: (root: string) => void,
  options?: FixtureOptions | undefined,
): void {
  const root = makeFixture(options)
  try {
    fn(root)
  } finally {
    safeDeleteSync(root)
  }
}
