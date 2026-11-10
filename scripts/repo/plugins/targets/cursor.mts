/**
 * Cursor. The repository root is the plugin. Its MCP config lives under
 * .cursor-plugin/, never at the root, where it would overwrite the
 * hand-maintained .mcp.json.
 */

import { DISPLAY_NAME, SOCKET_MCP, socketMcpServers } from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { PluginInputs } from '../target.mts'

export const CURSOR_MANIFEST = '.cursor-plugin/plugin.json'
export const CURSOR_MCP = '.cursor-plugin/mcp.json'
export const CURSOR_LOGO = '.cursor-plugin/logo.svg'
export const CURSOR_RULES = '.cursor-plugin/rules'

export function buildCursorManifest(
  ctx: PluginInputs,
): Record<string, unknown> {
  const { identity } = ctx
  return {
    name: identity.name,
    displayName: DISPLAY_NAME,
    skills: 'skills',
    rules: CURSOR_RULES,
    mcpServers: CURSOR_MCP,
    logo: CURSOR_LOGO,
    description: identity.description,
    version: identity.version,
    author: identity.author,
    homepage: identity.homepage,
    repository: identity.repository,
    license: identity.license,
    keywords: identity.keywords,
  }
}

export function buildCursorMcpConfig(): Record<string, unknown> {
  return { mcpServers: socketMcpServers({ url: SOCKET_MCP.url }) }
}

export const cursorTarget = definePluginTarget({
  id: 'cursor',
  agent: 'Cursor',
  files: [CURSOR_MANIFEST, CURSOR_MCP],
  dirs: [],
  sources: [CURSOR_LOGO, CURSOR_RULES],
  instructionDirs: [CURSOR_RULES],
  connect: {
    bundlesServer: true,
    signIn: [
      {
        howTo:
          'Open **Customize** in the sidebar, select the Socket server, and sign in to it.',
      },
    ],
  },
  generate(ctx) {
    ctx.out.json(CURSOR_MANIFEST, buildCursorManifest(ctx))
    ctx.out.json(CURSOR_MCP, buildCursorMcpConfig())
  },
})
