// node --test specs for scripts/repo/generate-cursor-plugin.mts.
//
// Regression guard for the 2026-07-24 incident: the generator used to write
// {"mcpServers": {}} over the repo root's tracked, fleet-populated .mcp.json,
// silently emptying the MCP server inventory. The plugin's mcp artifact now
// lives at .cursor-plugin/mcp.json; a populated root .mcp.json must survive a
// generator run byte-for-byte.

import test from 'node:test'
import assert from 'node:assert/strict'

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  buildCursorPluginManifest,
  generateCursorPlugin,
  renderJson,
} from '../generate-cursor-plugin.mts'

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
  return root
}

void test('generate leaves a populated root .mcp.json byte-identical', () => {
  const root = makeFixtureRoot()
  try {
    generateCursorPlugin(root, { check: false })

    const after = readFileSync(path.join(root, '.mcp.json'), 'utf-8')
    assert.strictEqual(after, POPULATED_MCP)
    assert.deepStrictEqual(JSON.parse(after), POPULATED_MCP_SERVERS)
  } finally {
    safeDeleteSync(root)
  }
})

void test('generate writes the empty plugin mcp config under .cursor-plugin/', () => {
  const root = makeFixtureRoot()
  try {
    const result = generateCursorPlugin(root, { check: false })

    assert.strictEqual(
      result.mcpPath,
      path.join(root, '.cursor-plugin', 'mcp.json'),
    )
    assert.deepStrictEqual(JSON.parse(readFileSync(result.mcpPath, 'utf-8')), {
      mcpServers: {},
    })
  } finally {
    safeDeleteSync(root)
  }
})

void test('manifest references the .cursor-plugin mcp artifact, not root .mcp.json', () => {
  const root = makeFixtureRoot()
  try {
    const manifest = buildCursorPluginManifest(root)
    assert.strictEqual(manifest['mcpServers'], '.cursor-plugin/mcp.json')
  } finally {
    safeDeleteSync(root)
  }
})

void test('check mode reports stale artifacts without writing anything', () => {
  const root = makeFixtureRoot()
  try {
    const result = generateCursorPlugin(root, { check: true })

    assert.deepStrictEqual(result.outdated.toSorted(), [
      path.join('.cursor-plugin', 'mcp.json'),
      path.join('.cursor-plugin', 'plugin.json'),
    ])
    assert.strictEqual(
      readFileSync(path.join(root, '.mcp.json'), 'utf-8'),
      POPULATED_MCP,
    )
  } finally {
    safeDeleteSync(root)
  }
})

void test('generate is idempotent: second check run reports up to date', () => {
  const root = makeFixtureRoot()
  try {
    generateCursorPlugin(root, { check: false })
    const result = generateCursorPlugin(root, { check: true })
    assert.deepStrictEqual(result.outdated, [])
  } finally {
    safeDeleteSync(root)
  }
})
