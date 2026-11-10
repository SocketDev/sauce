/**
 * Claude Code: .claude-plugin/marketplace.json lists every skill as its own
 * plugin. .claude-plugin/plugin.json is the hand-maintained identity every
 * target reads, so this target does not write it.
 */

import { skillRequires } from '../skills.mts'
import {
  CONNECT_SKILL,
  SOCKET_MCP,
  socketMcpServers,
  SOURCE_MANIFEST,
} from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { PluginInputs } from '../target.mts'

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
})
