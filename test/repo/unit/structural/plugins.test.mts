// The checked-in plugins agree with skills/ and with each other. Every check
// iterates the registry, so a new agent target is covered by listing it.

import { describe, expect, it } from 'vitest'

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  SHIPPED_DIRS,
  SHIPPED_INSTRUCTION_DIRS,
  SHIPPED_ROOT_FILES,
} from '../../../../scripts/repo/constants/shipped-surfaces.mts'
import { findTargetFiles } from '../../../../scripts/repo/inline-shared.mts'
import { REPO_ROOT } from '../../../../scripts/repo/paths.mts'
import {
  generatePlugins,
  renderSignInDoc,
} from '../../../../scripts/repo/plugins/generate.mts'
import {
  generatedDirs,
  generatedFiles,
  PLUGIN_TARGETS,
  SIGN_IN_DOC,
} from '../../../../scripts/repo/plugins/registry.mts'
import {
  discoverSkills,
  findInlineShell,
  skillCategory,
} from '../../../../scripts/repo/plugins/skills.mts'
import {
  CONNECT_SKILL,
  readPluginIdentity,
  SOCKET_MCP,
} from '../../../../scripts/repo/plugins/socket.mts'
import { HERMES_MCP_ADD_COMMAND } from '../../../../scripts/repo/plugins/targets/hermes.mts'
import {
  GENERATED_DIRS,
  GENERATED_FILES,
} from '../../../../scripts/repo/publish.mts'

const skills = discoverSkills(REPO_ROOT)
const identity = readPluginIdentity(REPO_ROOT)
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf-8')
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>

const SPEC_SKILLS = [
  'socket-firewall',
  'socket-pr-alerts',
  'socket-reachability',
  'socket-incident-response',
  'socket-policy',
  'socket-sbom',
  'socket-vet-agent-tools',
  'knowledge-update',
]

describe('generated plugins', () => {
  it('are up to date', () => {
    expect(generatePlugins(REPO_ROOT, { check: true }).outdated).toStrictEqual(
      [],
    )
  })

  it('publish.mts tracks every registry output', () => {
    for (const rel of generatedFiles()) {
      expect(GENERATED_FILES).toContain(rel)
    }
    expect([...GENERATED_DIRS]).toStrictEqual(generatedDirs())
  })

  it('every declared output and source exists', () => {
    for (const target of PLUGIN_TARGETS) {
      for (const rel of [...target.files, ...target.dirs, ...target.sources]) {
        expect(
          existsSync(path.join(REPO_ROOT, rel)),
          `${target.id}: ${rel}`,
        ).toBe(true)
      }
    }
  })

  it('every generated tree is a shipped surface', () => {
    for (const dir of generatedDirs()) {
      expect(SHIPPED_DIRS).toContain(dir.split('/')[0])
    }
  })
})

describe('skills', () => {
  it('include every skill from the coding-agents spec', () => {
    const names = skills.map(s => s.name)
    for (const name of SPEC_SKILLS) {
      expect(names).toContain(name)
    }
  })

  it('each declare a category', () => {
    for (const skill of skills) {
      expect(skillCategory(skill), skill.name).toBeTruthy()
    }
  })

  it('hold no inline shell snippet', () => {
    expect(findInlineShell(skills)).toStrictEqual([])
  })
})

describe('every agent gets every skill', () => {
  const names = skills.map(s => s.name).toSorted()

  it('claude: one marketplace plugin per skill', () => {
    const plugins = readJson('.claude-plugin/marketplace.json')[
      'plugins'
    ] as Array<{
      name: string
      source: string
    }>
    expect(plugins.map(p => p.name).toSorted()).toStrictEqual(names)
    for (const plugin of plugins) {
      expect(existsSync(path.join(REPO_ROOT, plugin.source, 'SKILL.md'))).toBe(
        true,
      )
    }
  })

  it('codex: every top-level skill root, which holds every nested skill', () => {
    const roots = readJson('skills/.codex-plugin/plugin.json')[
      'skills'
    ] as string[]
    for (const skill of skills) {
      const top = skill.relDir.split('/')[0]
      expect(roots, skill.name).toContain(`./${top}`)
    }
  })

  it('cursor: the whole skills directory', () => {
    expect(readJson('.cursor-plugin/plugin.json')['skills']).toBe('skills')
  })

  it('gemini: agents/README.md, which links every skill', () => {
    const manifest = readJson('gemini-extension.json')
    const context = read(manifest['contextFileName'])
    for (const skill of skills) {
      expect(context, skill.name).toContain(`skills/${skill.relDir}/SKILL.md`)
    }
  })

  it('hermes: one top-level copy per skill, byte for byte', () => {
    expect(
      readdirSync(path.join(REPO_ROOT, 'hermes', 'skills')).toSorted(),
    ).toStrictEqual(names)
    for (const skill of skills) {
      expect(read(`hermes/skills/${skill.name}/SKILL.md`)).toBe(
        read(`skills/${skill.relDir}/SKILL.md`),
      )
    }
  })
})

describe('every agent manifest agrees', () => {
  const jsonOutputs = PLUGIN_TARGETS.flatMap(target =>
    target.files.filter(f => f.endsWith('.json')).map(f => [target.id, f]),
  )

  it.each(jsonOutputs)('%s %s carries the plugin version', (_id, rel) => {
    for (const match of read(rel!).matchAll(/"version": "([^"]+)"/g)) {
      expect(match[1]).toBe(identity.version)
    }
  })

  it.each(jsonOutputs)(
    '%s %s names only the hosted MCP server URL',
    (_id, rel) => {
      for (const match of read(rel!).matchAll(/"(https:\/\/mcp\.[^"]+)"/g)) {
        expect(match[1]).toBe(SOCKET_MCP.url)
      }
    },
  )

  it('every target that bundles the server points at it', () => {
    for (const target of PLUGIN_TARGETS.filter(t => t.connect.bundlesServer)) {
      const text = target.files.map(read).join('\n')
      expect(text, target.id).toContain(SOCKET_MCP.url)
    }
  })

  it('the claude marketplace bundles the server in the connect skill', () => {
    const connect = (
      readJson('.claude-plugin/marketplace.json')['plugins'] as Array<
        Record<string, any>
      >
    ).find(p => p['name'] === CONNECT_SKILL)!
    expect(connect['mcpServers'].socket.url).toBe(SOCKET_MCP.url)
  })
})

describe('docs', () => {
  it('README has an install section for every agent', () => {
    const readme = read('README.md')
    for (const target of PLUGIN_TARGETS) {
      expect(readme, target.agent).toContain(`### ${target.agent}`)
    }
  })

  it('socket-connect inlines exactly the generated sign-in section', () => {
    const skill = read('skills/socket-connect/SKILL.md')
    const begin = '<!-- BEGIN_SECTION:agent-sign-in.md -->'
    const end = '<!-- END_SECTION:agent-sign-in.md -->'
    const inlined = skill.slice(
      skill.indexOf(begin) + begin.length,
      skill.indexOf(end),
    )
    const norm = (text: string) => text.replace(/\s+/g, ' ').trim()
    expect(skill.indexOf(begin)).toBeGreaterThan(-1)
    expect(norm(inlined)).toBe(norm(read(SIGN_IN_DOC)))
    expect(norm(read(SIGN_IN_DOC))).toBe(norm(renderSignInDoc()))
  })

  it('every generated root entry is classified as shipped', () => {
    for (const rel of [
      ...generatedFiles(),
      ...PLUGIN_TARGETS.flatMap(target => target.sources),
    ]) {
      const top = rel.split('/')[0]!
      expect([...SHIPPED_DIRS, ...SHIPPED_ROOT_FILES], rel).toContain(top)
    }
    for (const dir of PLUGIN_TARGETS.flatMap(t => t.instructionDirs ?? [])) {
      expect(SHIPPED_INSTRUCTION_DIRS).toContain(dir)
    }
  })

  it('every shared doc is used, and every used doc exists', () => {
    const docs = readdirSync(path.join(REPO_ROOT, 'skills', '_shared', 'docs'))
    const used = new Set<string>()
    for (const file of findTargetFiles(REPO_ROOT)) {
      for (const match of readFileSync(file, 'utf-8').matchAll(
        /<!-- BEGIN_SECTION:(\S+) -->/g,
      )) {
        used.add(match[1]!)
      }
    }
    expect([...used].toSorted()).toStrictEqual(docs.toSorted())
  })

  it('hermes README covers install, OAuth sign-in, and disclosures', () => {
    const readme = read('hermes/README.md')
    const repo = new URL(identity.repository!).pathname.replace(
      /^\/|\.git$/g,
      '',
    )
    expect(readme).toContain(`hermes plugins install ${repo}/hermes`)
    expect(read('README.md')).toContain(`hermes plugins install ${repo}/hermes`)
    expect(readme).toContain(HERMES_MCP_ADD_COMMAND)
    expect(readme).toContain('hermes mcp login socket')
    expect(readme).toContain('hermes plugins enable socket')
    for (const heading of [
      'Network calls',
      'Shell commands',
      'Credentials',
      'Telemetry',
    ]) {
      expect(readme).toContain(heading)
    }
  })
})
