// The checked-in Hermes plugin under hermes/ must match skills/ exactly, be
// loadable by Hermes, and tell users how to connect the OAuth MCP server.

import { describe, expect, it } from 'vitest'

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  AGENT_PLUGINS_SCHEMA_V1,
  buildHermesPluginManifest,
  collectHermesSkillFiles,
  generateHermesPlugin,
  HERMES_MCP_ADD_COMMAND,
  HERMES_PLUGIN_NAME,
  INLINE_SHELL_RE,
  validateHermesPlugin,
} from '../../../../scripts/repo/generate-hermes-plugin.mts'
import { collectSkillRoots } from '../../../../scripts/repo/generate-codex-plugin.mts'
import { parseFrontmatter } from '../../../../scripts/repo/lib/frontmatter.mts'
import { REPO_ROOT } from '../../../../scripts/repo/paths.mts'
import { SHIPPED_DIRS } from '../../../../scripts/repo/constants/shipped-surfaces.mts'

const HERMES_DIR = path.join(REPO_ROOT, 'hermes')

function findSkillMds(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...findSkillMds(full))
    } else if (entry.name === 'SKILL.md' && dir !== HERMES_DIR) {
      out.push(full)
    }
  }
  return out.toSorted()
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.name === '.DS_Store') {
      continue
    }
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, entry.name), rel))
    } else {
      out.push(rel)
    }
  }
  return out.toSorted()
}

describe('hermes/ plugin', () => {
  it('is up to date with skills/', () => {
    expect(generateHermesPlugin(REPO_ROOT, { check: true }).outdated).toEqual(
      [],
    )
  })

  it('holds only plugin.json, README.md, and the skills mirror', () => {
    const expected = [
      'README.md',
      'plugin.json',
      ...[...collectHermesSkillFiles().keys()].map(rel => `skills/${rel}`),
    ].toSorted()
    expect(listFiles(HERMES_DIR)).toStrictEqual(expected)
  })

  it('ships no mcp.json, since a portable entry cannot request OAuth', () => {
    expect(existsSync(path.join(HERMES_DIR, 'mcp.json'))).toBe(false)
  })

  it('has a manifest Hermes accepts', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(HERMES_DIR, 'plugin.json'), 'utf-8'),
    )
    expect(manifest['$schema']).toBe(AGENT_PLUGINS_SCHEMA_V1)
    expect(manifest['name']).toBe(HERMES_PLUGIN_NAME)
    expect(manifest).toStrictEqual(buildHermesPluginManifest())
    expect(
      validateHermesPlugin(manifest, collectHermesSkillFiles()),
    ).toStrictEqual([])
  })

  it('carries the same version as the Claude plugin', () => {
    const claude = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'),
        'utf-8',
      ),
    )
    const hermes = JSON.parse(
      readFileSync(path.join(HERMES_DIR, 'plugin.json'), 'utf-8'),
    )
    expect(hermes.version).toBe(claude.version)
  })

  it('loads every skill under skills/, at any depth, one level deep', () => {
    const sourceNames = findSkillMds(path.join(REPO_ROOT, 'skills')).map(
      file => parseFrontmatter(readFileSync(file, 'utf-8'))['name'],
    )
    const hermesNames = readdirSync(path.join(HERMES_DIR, 'skills')).toSorted()
    expect(hermesNames).toStrictEqual(sourceNames.toSorted())
    expect(new Set(hermesNames).size).toBe(hermesNames.length)
    for (const name of hermesNames) {
      const skillMd = path.join(HERMES_DIR, 'skills', name, 'SKILL.md')
      expect(existsSync(skillMd), name).toBe(true)
      expect(parseFrontmatter(readFileSync(skillMd, 'utf-8'))['name']).toBe(
        name,
      )
    }
  })

  it('has no SKILL.md below hermes/skills/<name>/', () => {
    const nested = findSkillMds(path.join(HERMES_DIR, 'skills')).filter(
      file =>
        path.relative(path.join(HERMES_DIR, 'skills'), file).split(path.sep)
          .length !== 2,
    )
    expect(nested).toStrictEqual([])
  })

  it('covers every skill the Codex plugin lists', () => {
    for (const root of collectSkillRoots(path.join(REPO_ROOT, 'skills'))) {
      expect(
        existsSync(path.join(HERMES_DIR, 'skills', root.slice(2), 'SKILL.md')),
        root,
      ).toBe(true)
    }
  })

  it('no skill holds an inline shell snippet Hermes would run', () => {
    const offenders = listFiles(path.join(REPO_ROOT, 'skills'))
      .filter(rel => rel.endsWith('.md'))
      .filter(rel =>
        INLINE_SHELL_RE.test(
          readFileSync(path.join(REPO_ROOT, 'skills', rel), 'utf-8'),
        ),
      )
    expect(offenders).toStrictEqual([])
  })

  it('README install command names this repository', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(HERMES_DIR, 'plugin.json'), 'utf-8'),
    )
    const repo = new URL(manifest.repository).pathname.replace(
      /^\/|\.git$/g,
      '',
    )
    const readme = readFileSync(path.join(HERMES_DIR, 'README.md'), 'utf-8')
    expect(readme).toContain(`hermes plugins install ${repo}/hermes`)
    expect(readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf-8')).toContain(
      `hermes plugins install ${repo}/hermes`,
    )
  })

  it('includes every spec skill', () => {
    for (const name of [
      'socket-firewall',
      'socket-pr-alerts',
      'socket-reachability',
      'socket-incident-response',
      'socket-policy',
      'socket-sbom',
      'socket-vet-agent-tools',
      'knowledge-update',
      'socket-connect',
      'socket-dep-cleanup',
      'socket-dep-patch',
      'socket-dep-replace',
      'socket-dep-upgrade',
      'socket-scan-setup',
    ]) {
      expect(
        existsSync(path.join(HERMES_DIR, 'skills', name, 'SKILL.md')),
        name,
      ).toBe(true)
    }
  })

  it('is classified as a shipped tree so the shipped-content scans cover it', () => {
    expect(SHIPPED_DIRS).toContain('hermes')
  })

  it('README tells users how to add the OAuth MCP server and sign in', () => {
    const readme = readFileSync(path.join(HERMES_DIR, 'README.md'), 'utf-8')
    expect(readme).toContain(HERMES_MCP_ADD_COMMAND)
    expect(readme).toContain('hermes mcp login socket')
    expect(readme).toContain(`hermes plugins enable ${HERMES_PLUGIN_NAME}`)
    expect(readme).not.toMatch(/api[_ -]?key\s*=|SOCKET_API_TOKEN=/i)
  })

  it('socket-connect tells Hermes users how to connect', () => {
    for (const file of [
      path.join(REPO_ROOT, 'skills', 'socket-connect', 'SKILL.md'),
      path.join(HERMES_DIR, 'skills', 'socket-connect', 'SKILL.md'),
    ]) {
      const text = readFileSync(file, 'utf-8')
      expect(text).toContain(HERMES_MCP_ADD_COMMAND)
      expect(text).toContain('hermes mcp login socket')
    }
  })
})
