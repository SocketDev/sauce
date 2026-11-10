// Specs for the plugin generator entry point and the shared identity.

import { describe, expect, it } from 'vitest'

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  buildPluginContext,
  generatePlugins,
  renderSignInDoc,
  selectTargets,
} from '../../../../scripts/repo/plugins/generate.mts'
import { ArtifactWriter } from '../../../../scripts/repo/plugins/output.mts'
import {
  PLUGIN_TARGETS,
  SIGN_IN_DOC,
} from '../../../../scripts/repo/plugins/registry.mts'
import {
  readPluginIdentity,
  SOURCE_MANIFEST,
} from '../../../../scripts/repo/plugins/socket.mts'
import type { PluginTarget } from '../../../../scripts/repo/plugins/target.mts'
import { withFixture, writeFile } from './fixture.mts'

const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/repo/plugins/generate.mts',
)

describe('renderSignInDoc', () => {
  it('lists every target’s rows in registry order, then add-server commands', () => {
    const doc = renderSignInDoc()
    const rows = PLUGIN_TARGETS.flatMap(t =>
      t.connect.signIn.map(r => ({
        agent: r.agent ?? t.agent,
        howTo: r.howTo,
      })),
    )
    let at = 0
    for (const row of rows) {
      const index = doc.indexOf(`| ${row.agent} `)
      expect(index, row.agent).toBeGreaterThan(at)
      expect(doc).toContain(row.howTo)
      at = index
    }
    for (const target of PLUGIN_TARGETS) {
      if (target.connect.addServer) {
        expect(doc).toContain(target.connect.addServer.intro)
        expect(doc).toContain(
          `\`\`\`shell\n${target.connect.addServer.command}\n\`\`\``,
        )
      }
    }
  })

  it('names the plugins that bundle the server and the ones that do not', () => {
    const doc = renderSignInDoc()
    const lead = doc.split('\n')[0]!
    for (const target of PLUGIN_TARGETS) {
      expect(lead, target.agent).toContain(target.agent)
    }
    const bundling = PLUGIN_TARGETS.filter(t => t.connect.bundlesServer)
    const others = PLUGIN_TARGETS.filter(t => !t.connect.bundlesServer)
    for (const t of bundling) {
      expect(lead.indexOf(t.agent)).toBeLessThan(lead.indexOf('plugins add'))
    }
    for (const t of others) {
      expect(lead.indexOf(t.agent)).toBeGreaterThan(lead.indexOf('plugins add'))
    }
  })

  it.each([
    [['A'], [], 'The A plugins add'],
    [['A', 'B'], [], 'The A and B plugins add'],
    [['A', 'B', 'C'], ['D'], 'The A, B, and C plugins add'],
    [['A'], ['D', 'E'], 'The A plugins add'],
  ])('lists %j in prose', (bundling, others, expected) => {
    const make = (agent: string, bundlesServer: boolean): PluginTarget => ({
      ...PLUGIN_TARGETS[0]!,
      agent,
      connect: { bundlesServer, signIn: [{ howTo: 'x' }] },
    })
    const doc = renderSignInDoc([
      ...bundling.map(a => make(a, true)),
      ...others.map(a => make(a, false)),
    ])
    expect(doc).toContain(expected)
    expect(doc).toContain(
      others.length > 0
        ? `In ${others.join(' and ')}, or when the skills`
        : 'When the skills are installed without a plugin',
    )
  })

  it('pads columns to an aligned table', () => {
    const fake: PluginTarget = {
      ...PLUGIN_TARGETS[0]!,
      connect: {
        bundlesServer: false,
        signIn: [
          { agent: 'A', howTo: 'short' },
          { agent: 'Longer agent', howTo: 'x' },
        ],
      },
    }
    expect(renderSignInDoc([fake]).replace(/^The .*\n\n/, '')).toBe(
      '| Agent        | How to sign in |\n' +
        '| ------------ | -------------- |\n' +
        '| A            | short          |\n' +
        '| Longer agent | x              |\n',
    )
  })
})

describe('generatePlugins', () => {
  it('--sign-in-only writes only the shared doc', () => {
    withFixture(root => {
      generatePlugins(root, { signInOnly: true })
      expect(readFileSync(path.join(root, SIGN_IN_DOC), 'utf-8')).toBe(
        renderSignInDoc(),
      )
      expect(existsSync(path.join(root, 'gemini-extension.json'))).toBe(false)
    })
  })

  it('refuses skills that hold an inline shell snippet', () => {
    withFixture(root => {
      writeFile(root, 'skills/beta/x.md', 'Run !`date`\n')
      expect(() => generatePlugins(root)).toThrow(/inline !`command`/)
    })
  })

  it('refuses an empty skills tree', () => {
    withFixture(root => {
      safeDeleteSync(path.join(root, 'skills'))
      expect(() =>
        buildPluginContext(root, new ArtifactWriter(root, true)),
      ).toThrow(/No skills discovered/)
    })
  })

  it.each(
    PLUGIN_TARGETS.flatMap(t =>
      t.sources.filter(s => s !== SOURCE_MANIFEST).map(s => [t.id, s] as const),
    ),
  )('%s fails clearly when its source %s is missing', (id, source) => {
    withFixture(
      root => {
        const target = PLUGIN_TARGETS.find(t => t.id === id)!
        expect(() => generatePlugins(root, { targets: [target] })).toThrow(
          new RegExp(
            `Plugin sources are missing[\\s\\S]*${source.replaceAll('.', '\\.')}`,
          ),
        )
      },
      { omitSources: [source] },
    )
  })
})

describe('readPluginIdentity', () => {
  it('reads every field from the plugin manifest', () => {
    withFixture(root => {
      expect(readPluginIdentity(root)).toStrictEqual({
        name: 'fixture-skills',
        version: '9.9.9',
        description: 'Fixture skills.',
        author: { name: 'Fixture Co' },
        homepage: 'https://example.com/fixture/',
        repository: 'https://example.com/fixture',
        license: 'MIT',
        keywords: ['alpha', 'beta'],
      })
    })
  })

  it.each([
    [
      'an invalid name',
      { name: 'Bad Name', version: '1.0.0' },
      /Invalid plugin name/,
    ],
    ['a missing version', { name: 'ok' }, /non-empty 'version'/],
  ])('rejects %s', (_label, manifest, message) => {
    withFixture(
      root => {
        expect(() => readPluginIdentity(root)).toThrow(message)
      },
      { manifest },
    )
  })

  it('drops mistyped optional fields', () => {
    withFixture(
      root => {
        const identity = readPluginIdentity(root)
        expect(identity.author).toBeUndefined()
        expect(identity.keywords).toStrictEqual(['x'])
        expect(identity.license).toBeUndefined()
      },
      {
        manifest: {
          name: 'ok',
          version: '1.0.0',
          author: 'Someone',
          keywords: ['x', 3],
          license: 1,
        },
      },
    )
  })
})

describe('selectTargets', () => {
  it('selects every target by default', () => {
    expect(selectTargets(['--check'])).toBe(PLUGIN_TARGETS)
  })

  it.each(PLUGIN_TARGETS.map(t => [t.id, t] as const))(
    '--target %s selects only that target',
    (id, target) => {
      expect(selectTargets(['--target', id])).toStrictEqual([target])
    },
  )

  it('rejects an unknown or missing id', () => {
    expect(() => selectTargets(['--target', 'nope'])).toThrow(
      /Unknown target "nope"/,
    )
    expect(() => selectTargets(['--target'])).toThrow(/Unknown target/)
  })
})

describe('CLI', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [GENERATOR, ...args], { encoding: 'utf-8' })

  it('--check passes on the real repository', () => {
    const result = run('--check')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).toContain(
      `Plugin artifacts are up to date (${PLUGIN_TARGETS.map(t => t.agent).join(', ')}).`,
    )
  })

  it('--check --target checks only that target', () => {
    const result = run('--check', '--target', 'hermes')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).toContain(
      'Plugin artifacts are up to date (Hermes Agent).',
    )
  })

  it('rejects an unknown target', () => {
    const result = run('--check', '--target', 'nope')
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('Unknown target "nope"')
  })
})
