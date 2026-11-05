// Specs for scripts/repo/generate-cursor-plugin.mts.
//
// Regression guard for the 2026-07-24 incident: the generator used to write
// {"mcpServers": {}} over the repo root's tracked, fleet-populated .mcp.json,
// silently emptying the MCP server inventory. The plugin's mcp artifact now
// lives at .cursor-plugin/mcp.json; a populated root .mcp.json must survive a
// generator run byte-for-byte.
//
// The plugin mcp config declares Socket's hosted OAuth MCP server and nothing
// else: no headers, no token placeholders.

import { expect, it } from 'vitest'

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  buildCursorPluginManifest,
  buildMcpConfig,
  CURSOR_LOGO_RELATIVE,
  CURSOR_RULES_RELATIVE,
  generateCursorPlugin,
  renderJson,
  SOCKET_MCP_URL,
} from '../../../scripts/repo/generate-cursor-plugin.mts'

const POPULATED_MCP_SERVERS = {
  mcpServers: {
    'chrome-devtools': {
      command: 'pnpm',
      args: ['exec', 'chrome-devtools-mcp', '--isolated'],
    },
    linear: {
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
    },
  },
}

const POPULATED_MCP = renderJson(POPULATED_MCP_SERVERS)

function makeFixtureRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cursor-plugin-fixture-'))
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    renderJson({ name: 'fixture-skills', version: '9.9.9' }),
    'utf-8',
  )
  mkdirSync(path.join(root, 'skills', 'demo'), { recursive: true })
  writeFileSync(
    path.join(root, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: A demo skill.\n---\n\n# demo\n',
    'utf-8',
  )
  writeFileSync(path.join(root, '.mcp.json'), POPULATED_MCP, 'utf-8')
  mkdirSync(path.join(root, CURSOR_RULES_RELATIVE), { recursive: true })
  writeFileSync(
    path.join(root, CURSOR_RULES_RELATIVE, 'demo.mdc'),
    '---\ndescription: A demo rule.\nalwaysApply: false\n---\n\n# demo\n',
    'utf-8',
  )
  writeFileSync(path.join(root, CURSOR_LOGO_RELATIVE), '<svg/>\n', 'utf-8')
  return root
}

it('generate leaves a populated root .mcp.json byte-identical', () => {
  const root = makeFixtureRoot()
  try {
    generateCursorPlugin(root, { check: false })

    const after = readFileSync(path.join(root, '.mcp.json'), 'utf-8')
    expect(after).toBe(POPULATED_MCP)
    expect(JSON.parse(after)).toStrictEqual(POPULATED_MCP_SERVERS)
  } finally {
    safeDeleteSync(root)
  }
})

it('generate writes the hosted Socket MCP server config under .cursor-plugin/', () => {
  const root = makeFixtureRoot()
  try {
    const result = generateCursorPlugin(root, { check: false })

    expect(result.mcpPath).toBe(path.join(root, '.cursor-plugin', 'mcp.json'))
    expect(JSON.parse(readFileSync(result.mcpPath, 'utf-8'))).toStrictEqual({
      mcpServers: { socket: { url: 'https://mcp.socket.dev/' } },
    })
  } finally {
    safeDeleteSync(root)
  }
})

it('mcp config carries only the OAuth server URL, never a credential', () => {
  const config = buildMcpConfig()
  expect(config).toStrictEqual({
    mcpServers: { socket: { url: SOCKET_MCP_URL } },
  })
  expect(JSON.stringify(config)).not.toMatch(/\$\{|authorization|token/i)
})

it('manifest references the Cursor rules, logo and display name', () => {
  const root = makeFixtureRoot()
  try {
    const manifest = buildCursorPluginManifest({ root })
    expect(manifest['displayName']).toBe('Socket')
    expect(manifest['rules']).toBe(CURSOR_RULES_RELATIVE)
    expect(manifest['logo']).toBe(CURSOR_LOGO_RELATIVE)
  } finally {
    safeDeleteSync(root)
  }
})

it('manifest generation fails when a Cursor source is missing', () => {
  const root = makeFixtureRoot()
  try {
    safeDeleteSync(path.join(root, CURSOR_LOGO_RELATIVE))
    expect(() => buildCursorPluginManifest({ root })).toThrow(
      CURSOR_LOGO_RELATIVE,
    )
  } finally {
    safeDeleteSync(root)
  }
})

it('manifest references the .cursor-plugin mcp artifact, not root .mcp.json', () => {
  const root = makeFixtureRoot()
  try {
    const manifest = buildCursorPluginManifest({ root })
    expect(manifest['mcpServers']).toBe('.cursor-plugin/mcp.json')
  } finally {
    safeDeleteSync(root)
  }
})

it('check mode reports stale artifacts without writing anything', () => {
  const root = makeFixtureRoot()
  try {
    const result = generateCursorPlugin(root, { check: true })

    expect(result.outdated.toSorted()).toStrictEqual([
      path.join('.cursor-plugin', 'mcp.json'),
      path.join('.cursor-plugin', 'plugin.json'),
    ])
    expect(readFileSync(path.join(root, '.mcp.json'), 'utf-8')).toBe(
      POPULATED_MCP,
    )
  } finally {
    safeDeleteSync(root)
  }
})

it('generate is idempotent: second check run reports up to date', () => {
  const root = makeFixtureRoot()
  try {
    generateCursorPlugin(root, { check: false })
    const result = generateCursorPlugin(root, { check: true })
    expect(result.outdated).toStrictEqual([])
  } finally {
    safeDeleteSync(root)
  }
})
