// Specs for scripts/repo/generate-codex-plugin.mts.
//
// The generator must never touch the fleet's root .mcp.json inventory or the
// generated .codex/ adapter dir, and must keep every Codex manifest path in
// the './'-prefixed form Codex requires.

import { expect, it } from 'vitest'

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  buildCodexMarketplace,
  buildCodexMcpConfig,
  buildCodexPluginManifest,
  collectSkillRoots,
  generateCodexPlugin,
  renderFormattedJson,
  SOCKET_MCP_URL,
} from '../../../scripts/repo/generate-codex-plugin.mts'
import { renderJson } from '../../../scripts/repo/generate-cursor-plugin.mts'

const POPULATED_MCP = renderJson({
  mcpServers: {
    linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
  },
})

function writeSkill(root: string, rel: string, name: string): void {
  mkdirSync(path.join(root, 'skills', rel), { recursive: true })
  writeFileSync(
    path.join(root, 'skills', rel, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A demo skill.\n---\n\n# ${name}\n`,
    'utf-8',
  )
}

function makeFixtureRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codex-plugin-fixture-'))
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    renderJson({
      name: 'fixture-skills',
      version: '9.9.9',
      description: 'Fixture skills.',
      author: { name: 'Fixture Co' },
      homepage: 'https://example.com',
    }),
    'utf-8',
  )
  writeSkill(root, 'beta', 'beta')
  writeSkill(root, 'alpha', 'alpha')
  writeSkill(root, path.join('alpha', 'alpha-sub'), 'alpha-sub')
  mkdirSync(path.join(root, 'skills', '_shared', 'docs'), { recursive: true })
  mkdirSync(path.join(root, 'skills', 'no-skill-md'), { recursive: true })
  // Dot and underscore dirs are skipped even when they hold a SKILL.md.
  writeSkill(root, '.hidden', 'hidden')
  writeSkill(root, '_private', 'private')
  writeFileSync(path.join(root, '.mcp.json'), POPULATED_MCP, 'utf-8')
  return root
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

it('generate leaves root .mcp.json byte-identical and writes no .codex/', () => {
  const root = makeFixtureRoot()
  try {
    generateCodexPlugin(root, { check: false })

    expect(readFileSync(path.join(root, '.mcp.json'), 'utf-8')).toBe(
      POPULATED_MCP,
    )
    expect(existsSync(path.join(root, '.codex'))).toBe(false)
    expect(existsSync(path.join(root, 'skills', '.mcp.json'))).toBe(false)
  } finally {
    safeDeleteSync(root)
  }
})

it('generate writes the three Codex artifacts at their discovery paths', () => {
  const root = makeFixtureRoot()
  try {
    const result = generateCodexPlugin(root, { check: false })

    expect(result.manifestPath).toBe(
      path.join(root, 'skills', '.codex-plugin', 'plugin.json'),
    )
    expect(result.mcpPath).toBe(
      path.join(root, 'skills', '.codex-plugin', 'mcp.json'),
    )
    expect(result.marketplacePath).toBe(
      path.join(root, '.agents', 'plugins', 'marketplace.json'),
    )
    expect(readJson(result.mcpPath)).toStrictEqual(buildCodexMcpConfig())
    expect(readJson(result.manifestPath)).toStrictEqual(
      buildCodexPluginManifest({ root }),
    )
    expect(readJson(result.marketplacePath)).toStrictEqual(
      buildCodexMarketplace({ root }),
    )
  } finally {
    safeDeleteSync(root)
  }
})

it('mcp config points Codex at the hosted Socket server over OAuth', () => {
  const config = buildCodexMcpConfig() as {
    mcpServers: Record<string, Record<string, unknown>>
  }
  const server = config.mcpServers['socket']!
  expect(server['url']).toBe(SOCKET_MCP_URL)
  expect(server['scopes']).toStrictEqual([
    'packages:list',
    'alerts:list',
    'threat-feed:list',
  ])
  // A bearer token setting disables Codex's OAuth flow.
  expect(server).not.toHaveProperty('bearer_token_env_var')
  expect(server).not.toHaveProperty('http_headers')
})

it('manifest uses ./-prefixed paths and copies identity from the Claude manifest', () => {
  const root = makeFixtureRoot()
  try {
    const manifest = buildCodexPluginManifest({ root })
    expect(manifest['name']).toBe('fixture-skills')
    expect(manifest['version']).toBe('9.9.9')
    expect(manifest['description']).toBe('Fixture skills.')
    expect(manifest['mcpServers']).toBe('./.codex-plugin/mcp.json')
    expect(manifest['skills']).toStrictEqual(['./alpha', './beta'])
    const iface = manifest['interface'] as Record<string, unknown>
    expect(iface['developerName']).toBe('Fixture Co')
    const prompts = iface['defaultPrompt'] as string[]
    expect(prompts.length).toBeLessThanOrEqual(3)
    for (let i = 0, { length } = prompts; i < length; i += 1) {
      expect(prompts[i]!.length).toBeLessThanOrEqual(128)
    }
  } finally {
    safeDeleteSync(root)
  }
})

it('skill roots skip _shared, dot dirs, dirs without SKILL.md, and subskills', () => {
  const root = makeFixtureRoot()
  try {
    generateCodexPlugin(root, { check: false })
    expect(collectSkillRoots(path.join(root, 'skills'))).toStrictEqual([
      './alpha',
      './beta',
    ])
  } finally {
    safeDeleteSync(root)
  }
})

it('marketplace entry sources the skills dir under the manifest name', () => {
  const root = makeFixtureRoot()
  try {
    const marketplace = buildCodexMarketplace({ root }) as {
      name: string
      plugins: Array<Record<string, unknown>>
    }
    expect(marketplace.name).toBe('fixture-skills')
    expect(marketplace.plugins).toHaveLength(1)
    const entry = marketplace.plugins[0]!
    expect(entry['name']).toBe(buildCodexPluginManifest({ root })['name'])
    expect(entry['source']).toStrictEqual({ source: 'local', path: './skills' })
    expect(entry['policy']).toStrictEqual({
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    })
  } finally {
    safeDeleteSync(root)
  }
})

it('check mode reports stale artifacts without writing anything', () => {
  const root = makeFixtureRoot()
  try {
    const result = generateCodexPlugin(root, { check: true })

    expect(result.outdated.toSorted()).toStrictEqual([
      path.join('.agents', 'plugins', 'marketplace.json'),
      path.join('skills', '.codex-plugin', 'mcp.json'),
      path.join('skills', '.codex-plugin', 'plugin.json'),
    ])
    expect(existsSync(path.join(root, '.agents'))).toBe(false)
    expect(existsSync(path.join(root, 'skills', '.codex-plugin'))).toBe(false)
  } finally {
    safeDeleteSync(root)
  }
})

it('generate is idempotent: second check run reports up to date', () => {
  const root = makeFixtureRoot()
  try {
    generateCodexPlugin(root, { check: false })
    const result = generateCodexPlugin(root, { check: true })
    expect(result.outdated).toStrictEqual([])
  } finally {
    safeDeleteSync(root)
  }
})

it('renderFormattedJson keeps short primitive arrays inline and breaks long ones', () => {
  const longItems = Array.from({ length: 8 }, (_, i) => `item-number-${i}`)
  expect(
    renderFormattedJson({ short: ['a', 'b'], long: longItems, nested: {} }),
  ).toBe(
    '{\n' +
      '  "short": ["a", "b"],\n' +
      '  "long": [\n' +
      longItems.map(item => `    "${item}"`).join(',\n') +
      '\n  ],\n' +
      '  "nested": {}\n' +
      '}\n',
  )
})

it('renderFormattedJson counts the trailing comma against the print width', () => {
  // 80 columns with no comma fits; the same array followed by a sibling key
  // needs a trailing comma, so it reaches 81 and must break.
  const item = 'x'.repeat(69)
  expect(renderFormattedJson({ k: [item] })).toBe(`{\n  "k": ["${item}"]\n}\n`)
  expect(renderFormattedJson({ k: [item], z: 1 })).toBe(
    `{\n  "k": [\n    "${item}"\n  ],\n  "z": 1\n}\n`,
  )
})
