// The contract every plugin target in the registry must meet. A new target
// gets these checks by being listed in registry.mts; nothing here names a
// specific agent.

import { describe, expect, it } from 'vitest'

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import {
  buildPluginContext,
  generatePlugins,
} from '../../../../scripts/repo/plugins/generate.mts'
import { ArtifactWriter } from '../../../../scripts/repo/plugins/output.mts'
import {
  generatedDirs,
  generatedFiles,
  PLUGIN_TARGETS,
} from '../../../../scripts/repo/plugins/registry.mts'
import { ROOT_MCP_JSON, withFixture } from './fixture.mts'

function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, rel)
      } else {
        out.set(rel, readFileSync(full).toString('base64'))
      }
    }
  }
  walk(root, '')
  return out
}

function isDeclared(
  rel: string,
  target: (typeof PLUGIN_TARGETS)[number],
): boolean {
  return (
    target.files.includes(rel) ||
    target.dirs.some(dir => rel.startsWith(`${dir}/`))
  )
}

describe('registry', () => {
  it('has unique ids, agent names, and outputs', () => {
    const ids = PLUGIN_TARGETS.map(t => t.id)
    const agents = PLUGIN_TARGETS.map(t => t.agent)
    const outputs = [...generatedFiles(), ...generatedDirs()]
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(agents).size).toBe(agents.length)
    expect(new Set(outputs).size).toBe(outputs.length)
  })

  it('lists repo-relative, forward-slash output paths', () => {
    for (const rel of [...generatedFiles(), ...generatedDirs()]) {
      expect(rel).not.toMatch(/^\/|\\|\.\.|\/$/)
    }
  })
})

describe.each(PLUGIN_TARGETS.map(t => [t.id, t] as const))(
  'target %s',
  (_id, target) => {
    it('declares its agent, outputs, and sign-in details', () => {
      expect(target.agent).toBeTruthy()
      expect(target.files.length + target.dirs.length).toBeGreaterThan(0)
      expect(target.connect.signIn.length).toBeGreaterThan(0)
      for (const row of target.connect.signIn) {
        expect(row.agent ?? target.agent).toBeTruthy()
        expect(row.howTo).toBeTruthy()
        expect(row.howTo).not.toContain('|')
      }
    })

    it('writes every declared output and nothing else', () => {
      withFixture(root => {
        const before = snapshot(root)
        const out = new ArtifactWriter(root, false)
        target.generate(buildPluginContext(root, out))
        const after = snapshot(root)
        for (const rel of target.files) {
          expect(existsSync(path.join(root, rel)), rel).toBe(true)
        }
        for (const dir of target.dirs) {
          expect(statSync(path.join(root, dir)).isDirectory(), dir).toBe(true)
        }
        for (const { 0: rel, 1: content } of after) {
          if (before.get(rel) !== content) {
            expect(isDeclared(rel, target), `${target.id} wrote ${rel}`).toBe(
              true,
            )
          }
        }
        expect(readFileSync(path.join(root, '.mcp.json'), 'utf-8')).toBe(
          ROOT_MCP_JSON,
        )
      })
    })

    it('check mode writes nothing and reports every output', () => {
      withFixture(root => {
        const before = snapshot(root)
        const report = generatePlugins(root, {
          check: true,
          targets: [target],
        })
        expect(snapshot(root)).toStrictEqual(before)
        for (const rel of target.files) {
          expect(report.outdated).toContain(rel)
        }
      })
    })

    it('is idempotent', () => {
      withFixture(root => {
        generatePlugins(root, { targets: [target] })
        const after = snapshot(root)
        const again = generatePlugins(root, { targets: [target] })
        expect(again).toStrictEqual({ outdated: [], removed: [] })
        expect(snapshot(root)).toStrictEqual(after)
        expect(
          generatePlugins(root, { check: true, targets: [target] }).outdated,
        ).toStrictEqual([])
      })
    })

    it('reports a hand edit to any output as drift and restores it', () => {
      withFixture(root => {
        generatePlugins(root, { targets: [target] })
        const rel = target.files[0] ?? `${target.dirs[0]}/x`
        const full = path.join(root, ...rel.split('/'))
        const original = existsSync(full) ? readFileSync(full) : undefined
        mkdirSync(path.dirname(full), { recursive: true })
        writeFileSync(full, 'edited\n')
        expect(
          generatePlugins(root, { check: true, targets: [target] }).outdated,
        ).toContain(rel)
        generatePlugins(root, { targets: [target] })
        if (original) {
          expect(readFileSync(full).equals(original)).toBe(true)
        } else {
          expect(existsSync(full)).toBe(false)
        }
      })
    })

    it('never puts a credential in what it writes', () => {
      withFixture(root => {
        generatePlugins(root, { targets: [target] })
        for (const rel of target.files) {
          const text = readFileSync(path.join(root, rel), 'utf-8')
          expect(text).not.toMatch(
            /bearer|authorization|api[_-]?key|api[_-]?token|SOCKET_[A-Z_]*TOKEN/i,
          )
        }
      })
    })

    it('carries the version and the hosted MCP server URL when it names them', () => {
      withFixture(root => {
        generatePlugins(root, { targets: [target] })
        for (const rel of target.files.filter(f => f.endsWith('.json'))) {
          const text = readFileSync(path.join(root, rel), 'utf-8')
          const versions = text.match(/"version": "[^"]+"/g) ?? []
          for (const v of versions) {
            expect(v).toBe('"version": "9.9.9"')
          }
          for (const url of text.match(/https:\/\/mcp\.[^"]+/g) ?? []) {
            expect(url).toBe('https://mcp.socket.dev/')
          }
        }
      })
    })
  },
)
