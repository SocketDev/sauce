// What each agent's plugin must say, beyond the shared contract.

import { describe, expect, it } from 'vitest'

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { generatePlugins } from '../../../../scripts/repo/plugins/generate.mts'
import { discoverSkills } from '../../../../scripts/repo/plugins/skills.mts'
import {
  readPluginIdentity,
  SOCKET_MCP,
} from '../../../../scripts/repo/plugins/socket.mts'
import { buildClaudeMarketplace } from '../../../../scripts/repo/plugins/targets/claude.mts'
import {
  buildCodexManifest,
  buildCodexMarketplace,
  buildCodexMcpConfig,
  codexTarget,
} from '../../../../scripts/repo/plugins/targets/codex.mts'
import {
  buildCursorManifest,
  buildCursorMcpConfig,
  cursorTarget,
} from '../../../../scripts/repo/plugins/targets/cursor.mts'
import { buildGeminiManifest } from '../../../../scripts/repo/plugins/targets/gemini.mts'
import {
  AGENT_PLUGINS_SCHEMA_V1,
  buildHermesManifest,
  HERMES_MAX_FILE_BYTES,
  HERMES_MAX_FILE_COUNT,
  HERMES_MAX_TOTAL_BYTES,
  HERMES_MCP_ADD_COMMAND,
  hermesSkillFiles,
  hermesTarget,
  validateHermesPlugin,
} from '../../../../scripts/repo/plugins/targets/hermes.mts'
import { sourcePlaceholder, withFixture, writeFile } from './fixture.mts'

function ctx(root: string) {
  return {
    root,
    identity: readPluginIdentity(root),
    skills: discoverSkills(root),
  }
}

describe('claude', () => {
  it('lists every skill, nested ones too, with its SKILL.md description', () => {
    withFixture(root => {
      const marketplace = buildClaudeMarketplace(ctx(root)) as {
        plugins: Array<Record<string, unknown>>
      }
      expect(
        marketplace.plugins.map(p => [p['name'], p['source']]),
      ).toStrictEqual([
        ['alpha', './skills/alpha'],
        ['alpha-sub', './skills/alpha/alpha-sub'],
        ['beta', './skills/beta'],
        ['socket-connect', './skills/socket-connect'],
      ])
      for (const plugin of marketplace.plugins) {
        expect(plugin['skills']).toBe('./')
        expect(plugin['description']).toBe(`The ${plugin['name']} skill.`)
      }
    })
  })

  it('takes dependencies from metadata.requires', () => {
    withFixture(root => {
      const { plugins } = buildClaudeMarketplace(ctx(root)) as {
        plugins: Array<Record<string, unknown>>
      }
      const byName = Object.fromEntries(plugins.map(p => [p['name'], p]))
      expect(byName['alpha']!['dependencies']).toStrictEqual(['socket-connect'])
      expect(byName['beta']!['dependencies']).toBeUndefined()
    })
  })

  it('bundles the MCP server only in the connect skill', () => {
    withFixture(root => {
      const { plugins } = buildClaudeMarketplace(ctx(root)) as {
        plugins: Array<Record<string, unknown>>
      }
      const withServer = plugins.filter(p => p['mcpServers'])
      expect(withServer.map(p => p['name'])).toStrictEqual(['socket-connect'])
      expect(withServer[0]!['mcpServers']).toStrictEqual({
        socket: { type: 'http', url: SOCKET_MCP.url },
      })
    })
  })

  it('copies identity and version from the plugin manifest', () => {
    withFixture(root => {
      const marketplace = buildClaudeMarketplace(ctx(root))
      expect(marketplace['name']).toBe('fixture-skills')
      expect(marketplace['owner']).toStrictEqual({ name: 'Fixture Co' })
      expect(marketplace['metadata']).toStrictEqual({
        description: 'Fixture skills.',
        version: '9.9.9',
      })
    })
  })
})

describe('codex', () => {
  it('lists top-level skill roots with ./ paths', () => {
    withFixture(root => {
      const manifest = buildCodexManifest(ctx(root))
      expect(manifest['skills']).toStrictEqual([
        './alpha',
        './beta',
        './socket-connect',
      ])
      expect(manifest['mcpServers']).toBe('./.codex-plugin/mcp.json')
      const iface = manifest['interface'] as Record<string, unknown>
      expect(iface['developerName']).toBe('Fixture Co')
      const prompts = iface['defaultPrompt'] as string[]
      expect(prompts.length).toBeLessThanOrEqual(3)
      for (const prompt of prompts) {
        expect(prompt.length).toBeLessThanOrEqual(128)
      }
    })
  })

  it('points Codex at the hosted server over OAuth with pinned scopes', () => {
    const server = (
      buildCodexMcpConfig() as {
        mcpServers: Record<string, Record<string, unknown>>
      }
    ).mcpServers['socket']!
    expect(server['url']).toBe(SOCKET_MCP.url)
    expect(server['scopes']).toStrictEqual([...SOCKET_MCP.scopes])
    expect(server).not.toHaveProperty('bearer_token_env_var')
    expect(server).not.toHaveProperty('http_headers')
  })

  it('sources the marketplace entry from skills/ under the plugin name', () => {
    withFixture(root => {
      expect(buildCodexMarketplace(ctx(root))).toStrictEqual({
        name: 'fixture-skills',
        interface: { displayName: 'Socket' },
        plugins: [
          {
            name: 'fixture-skills',
            source: { source: 'local', path: './skills' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Developer Tools',
          },
        ],
      })
    })
  })

  it('never writes a root .mcp.json or .codex/', () => {
    withFixture(root => {
      generatePlugins(root, { targets: [codexTarget] })
      expect(existsSync(path.join(root, '.codex'))).toBe(false)
      expect(existsSync(path.join(root, 'skills', '.mcp.json'))).toBe(false)
    })
  })
})

describe('cursor', () => {
  it('references the skills, rules, logo, and its own MCP config', () => {
    withFixture(root => {
      const manifest = buildCursorManifest(ctx(root))
      expect(manifest).toMatchObject({
        name: 'fixture-skills',
        displayName: 'Socket',
        skills: 'skills',
        rules: '.cursor-plugin/rules',
        mcpServers: '.cursor-plugin/mcp.json',
        logo: '.cursor-plugin/logo.svg',
        version: '9.9.9',
      })
    })
  })

  it('carries only the OAuth server URL', () => {
    expect(buildCursorMcpConfig()).toStrictEqual({
      mcpServers: { socket: { url: SOCKET_MCP.url } },
    })
  })

  it('fails when a hand-maintained Cursor source is missing', () => {
    withFixture(
      root => {
        expect(() =>
          generatePlugins(root, { targets: [cursorTarget] }),
        ).toThrow(/Plugin sources are missing[\s\S]*\.cursor-plugin\/logo\.svg/)
      },
      { omitSources: ['.cursor-plugin/logo.svg'] },
    )
  })
})

describe('gemini', () => {
  it('loads agents/README.md and the hosted server', () => {
    withFixture(root => {
      expect(buildGeminiManifest(ctx(root))).toStrictEqual({
        name: 'fixture-skills',
        description: 'Fixture skills.',
        version: '9.9.9',
        contextFileName: 'agents/README.md',
        mcpServers: { socket: { httpUrl: SOCKET_MCP.url } },
      })
    })
  })
})

describe('hermes', () => {
  it('writes an Agent Plugins v1 manifest with only accepted fields', () => {
    withFixture(root => {
      const manifest = buildHermesManifest(ctx(root))
      expect(JSON.parse(JSON.stringify(manifest))).toStrictEqual({
        $schema: AGENT_PLUGINS_SCHEMA_V1,
        name: 'socket',
        version: '9.9.9',
        description: 'Fixture skills.',
        author: { name: 'Fixture Co', url: 'https://socket.dev' },
        homepage: 'https://example.com/fixture/tree/main/hermes',
        repository: 'https://example.com/fixture',
        license: 'MIT',
        keywords: ['alpha', 'beta', 'hermes'],
      })
    })
  })

  it('does not duplicate an existing hermes keyword', () => {
    withFixture(
      root => {
        expect(buildHermesManifest(ctx(root))['keywords']).toStrictEqual([
          'x',
          'hermes',
        ])
      },
      { manifest: { name: 'n', version: '1.0.0', keywords: ['x', 'hermes'] } },
    )
  })

  it('flattens every skill into its own top-level directory', () => {
    withFixture(root => {
      expect([...hermesSkillFiles(ctx(root)).keys()]).toStrictEqual([
        'alpha/SKILL.md',
        'alpha/references/notes.md',
        'alpha-sub/SKILL.md',
        'alpha-sub/references/sub.md',
        'beta/SKILL.md',
        'socket-connect/SKILL.md',
      ])
    })
  })

  it('ships no mcp.json and leaves the README alone', () => {
    withFixture(root => {
      generatePlugins(root, { targets: [hermesTarget] })
      expect(readdirSync(path.join(root, 'hermes')).toSorted()).toStrictEqual([
        'README.md',
        'plugin.json',
        'skills',
      ])
      expect(
        readFileSync(path.join(root, 'hermes', 'README.md'), 'utf-8'),
      ).toBe(sourcePlaceholder('hermes/README.md'))
    })
  })

  it('reports, never deletes, a stray entry in hermes/', () => {
    withFixture(root => {
      generatePlugins(root, { targets: [hermesTarget] })
      writeFile(root, 'hermes/mcp.json', '{}\n')
      expect(
        generatePlugins(root, { targets: [hermesTarget] }).outdated,
      ).toStrictEqual(['hermes/mcp.json'])
      expect(existsSync(path.join(root, 'hermes', 'mcp.json'))).toBe(true)
    })
  })

  it('refuses to run without its README', () => {
    withFixture(
      root => {
        expect(() =>
          generatePlugins(root, { targets: [hermesTarget] }),
        ).toThrow(/Plugin sources are missing[\s\S]*hermes\/README\.md/)
      },
      { omitSources: ['hermes/README.md'] },
    )
  })

  it('refuses a plugin over the README-inclusive size cap', () => {
    withFixture(root => {
      writeFile(root, 'hermes/README.md', Buffer.alloc(HERMES_MAX_TOTAL_BYTES))
      expect(() => generatePlugins(root, { targets: [hermesTarget] })).toThrow(
        /over Hermes's 10MB cap/,
      )
    })
  })

  it('documents the OAuth add command', () => {
    expect(HERMES_MCP_ADD_COMMAND).toBe(
      'hermes mcp add socket --url https://mcp.socket.dev/ --auth oauth',
    )
    expect(hermesTarget.connect.addServer?.command).toBe(HERMES_MCP_ADD_COMMAND)
  })

  describe('validateHermesPlugin', () => {
    const manifest = { $schema: AGENT_PLUGINS_SCHEMA_V1, name: 'socket' }

    it.each([
      ['Upper'],
      ['has_underscore'],
      ['-leading'],
      ['double--hyphen'],
      ['dots..twice'],
      ['a'.repeat(65)],
    ])('rejects plugin name %j', name => {
      expect(
        validateHermesPlugin({ ...manifest, name }, new Map()),
      ).toStrictEqual([
        `plugin name ${JSON.stringify(name)} is not a valid v1 name`,
      ])
    })

    it('accepts a dotted plugin name', () => {
      expect(
        validateHermesPlugin({ ...manifest, name: 'socket.dev' }, new Map()),
      ).toStrictEqual([])
    })

    it('rejects a missing schema', () => {
      expect(validateHermesPlugin({ name: 'ok' }, new Map())).toStrictEqual([
        'plugin.json must declare the Agent Plugins v1 schema',
      ])
    })

    it('accepts a file at the per-file cap and rejects one byte more', () => {
      withFixture(root => {
        writeFile(root, 'big.bin', Buffer.alloc(HERMES_MAX_FILE_BYTES))
        const files = new Map([['beta/big.bin', path.join(root, 'big.bin')]])
        expect(validateHermesPlugin(manifest, files)).toStrictEqual([])
        writeFile(root, 'big.bin', Buffer.alloc(HERMES_MAX_FILE_BYTES + 1))
        expect(validateHermesPlugin(manifest, files)).toStrictEqual([
          `skills/beta/big.bin is ${HERMES_MAX_FILE_BYTES + 1} bytes, over Hermes's 1MB cap`,
        ])
      })
    })

    it('counts the manifest and README against the file cap', () => {
      withFixture(root => {
        const source = path.join(root, 'skills', 'beta', 'SKILL.md')
        const files = new Map<string, string>()
        for (let i = 0; i < HERMES_MAX_FILE_COUNT - 2; i += 1) {
          files.set(`beta/f${i}`, source)
        }
        expect(validateHermesPlugin(manifest, files)).toStrictEqual([])
        files.set('beta/one-more', source)
        expect(validateHermesPlugin(manifest, files)).toStrictEqual([
          `plugin has ${HERMES_MAX_FILE_COUNT + 1} files, over Hermes's ${HERMES_MAX_FILE_COUNT}-file cap`,
        ])
      })
    })

    it('counts extra bytes against the total cap', () => {
      expect(
        validateHermesPlugin(manifest, new Map(), {
          extraBytes: HERMES_MAX_TOTAL_BYTES + 1,
        }).join('\n'),
      ).toMatch(/over Hermes's 10MB cap/)
    })
  })
})

it('every target reads skills through the same discovery', () => {
  withFixture(root => {
    generatePlugins(root)
    expect(generatePlugins(root, { check: true }).outdated).toStrictEqual([])
    const names = discoverSkills(root).map(s => s.name)
    const claude = JSON.parse(
      readFileSync(
        path.join(root, '.claude-plugin', 'marketplace.json'),
        'utf-8',
      ),
    ) as { plugins: Array<{ name: string }> }
    expect(claude.plugins.map(p => p.name)).toStrictEqual(names)
    expect(
      readdirSync(path.join(root, 'hermes', 'skills')).toSorted(),
    ).toStrictEqual(names)
  })
})
