/**
 * Claude Code: .claude-plugin/marketplace.json lists every skill as its own
 * plugin. .claude-plugin/plugin.json is the hand-maintained identity every
 * target reads, so this target does not write it.
 */

import path from 'node:path'

import {
  collectUrls,
  findSkillNames,
  parseJsonOutput,
  readJson,
} from '../load.mts'
import { skillRequires } from '../skills.mts'
import {
  CONNECT_SKILL,
  SOCKET_MCP,
  socketMcpServers,
  SOURCE_MANIFEST,
} from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { LoadCheck, PluginInputs } from '../target.mts'

export const CLAUDE_MARKETPLACE = '.claude-plugin/marketplace.json'

export function buildClaudeMarketplace(
  ctx: PluginInputs,
): Record<string, unknown> {
  const { identity, skills } = ctx
  return {
    name: identity.name,
    owner: { name: identity.author?.name ?? identity.name },
    metadata: {
      description: identity.description,
      version: identity.version,
    },
    plugins: skills.map(skill => {
      const requires = skillRequires(skill)
      return {
        name: skill.name,
        source: `./skills/${skill.relDir}`,
        skills: './',
        description: skill.description,
        dependencies: requires.length > 0 ? requires : undefined,
        mcpServers:
          skill.name === CONNECT_SKILL
            ? socketMcpServers({ type: 'http', url: SOCKET_MCP.url })
            : undefined,
      }
    }),
  }
}

/**
 * Validates the marketplace, installs every plugin it lists, and reads back
 * what Claude Code installed.
 */
export const claudeLoadCheck: LoadCheck = {
  cli: {
    bin: 'claude',
    install: { tool: 'npm', spec: '@anthropic-ai/claude-code@2.1.312' },
    isolate: home => ({
      CLAUDE_CONFIG_DIR: home,
      DISABLE_AUTOUPDATER: '1',
    }),
  },
  load(session) {
    const marketplace = path.join(session.dir, CLAUDE_MARKETPLACE)
    session.run(['plugin', 'validate', '--strict', marketplace])
    const manifest = readJson(marketplace)
    const plugins = manifest['plugins'] as Array<{ name: string }>
    session.run(['plugin', 'marketplace', 'add', session.dir])
    for (const plugin of plugins) {
      session.run([
        'plugin',
        'install',
        `${plugin.name}@${String(manifest['name'])}`,
      ])
    }
    const listed = parseJsonOutput(
      session.run(['plugin', 'list', '--json']),
    ) as Array<{
      id: string
      enabled: boolean
      installPath: string
      mcpServers?: unknown
    }>
    const disabled = listed.filter(p => !p.enabled).map(p => p.id)
    if (disabled.length > 0) {
      throw new Error(`Installed but not enabled: ${disabled.join(', ')}`)
    }
    if (listed.length !== plugins.length) {
      throw new Error(
        `Installed ${listed.length} of the ${plugins.length} plugins in the marketplace.`,
      )
    }
    return {
      skills: listed.flatMap(p => findSkillNames(p.installPath, 1)),
      mcpUrls: listed.flatMap(p => collectUrls(p.mcpServers)),
    }
  },
}

export const claudeTarget = definePluginTarget({
  id: 'claude',
  agent: 'Claude Code',
  files: [CLAUDE_MARKETPLACE],
  dirs: [],
  sources: [SOURCE_MANIFEST],
  connect: {
    bundlesServer: true,
    signIn: [
      {
        howTo:
          'Run `/mcp`, pick the Socket server, then choose **Authenticate**. A browser window opens.',
      },
      {
        agent: 'Claude Code (shell)',
        howTo:
          '`claude mcp login <server-name>`, using the name shown by `/mcp`. Add `--no-browser` over SSH.',
      },
    ],
    addServer: {
      intro: 'In Claude Code:',
      command: `claude mcp add --transport http ${SOCKET_MCP.name} ${SOCKET_MCP.url}`,
    },
  },
  generate(ctx) {
    ctx.out.json(CLAUDE_MARKETPLACE, buildClaudeMarketplace(ctx))
  },
  loadCheck: claudeLoadCheck,
})
