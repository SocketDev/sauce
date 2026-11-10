/**
 * Gemini CLI. The extension loads agents/README.md as its context file and
 * registers the hosted MCP server.
 */

import { SOCKET_MCP, socketMcpServers } from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { PluginInputs } from '../target.mts'

export const GEMINI_MANIFEST = 'gemini-extension.json'
export const GEMINI_CONTEXT_FILE = 'agents/README.md'

export function buildGeminiManifest(
  ctx: PluginInputs,
): Record<string, unknown> {
  const { identity } = ctx
  return {
    name: identity.name,
    description: identity.description,
    version: identity.version,
    contextFileName: GEMINI_CONTEXT_FILE,
    mcpServers: socketMcpServers({ httpUrl: SOCKET_MCP.url }),
  }
}

export const geminiTarget = definePluginTarget({
  id: 'gemini',
  agent: 'Gemini CLI',
  files: [GEMINI_MANIFEST],
  dirs: [],
  sources: [],
  connect: {
    bundlesServer: true,
    signIn: [{ howTo: 'Run `/mcp auth socket`.' }],
  },
  generate(ctx) {
    ctx.out.json(GEMINI_MANIFEST, buildGeminiManifest(ctx))
  },
})
