/**
 * Gemini CLI. The extension loads agents/README.md as its context file and
 * registers the hosted MCP server.
 */

import path from 'node:path'

import { collectUrls, parseJsonOutput, readJson } from '../load.mts'
import { SOCKET_MCP, socketMcpServers } from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { LoadCheck, PluginInputs } from '../target.mts'

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

/**
 * Validates and installs the build as a Gemini CLI extension, then reads the
 * skills and MCP servers Gemini CLI loaded from it. The build folder is
 * trusted through the environment, since the install otherwise asks.
 */
export const geminiLoadCheck: LoadCheck = {
  cli: {
    bin: 'gemini',
    install: { tool: 'npm', spec: '@google/gemini-cli@0.66.0' },
    isolate: home => ({
      GEMINI_CLI_HOME: home,
      GEMINI_CLI_TRUST_WORKSPACE: 'true',
    }),
  },
  load(session) {
    const { name } = readJson(path.join(session.dir, GEMINI_MANIFEST))
    session.run(['extensions', 'validate', session.dir])
    session.run([
      'extensions',
      'install',
      session.dir,
      '--consent',
      '--skip-settings',
    ])
    const listed = parseJsonOutput(
      session.run(['extensions', 'list', '-o', 'json']),
    ) as Array<{ name: string; skills?: unknown[]; mcpServers?: unknown }>
    const extension = listed.find(e => e.name === name)
    if (!extension) {
      throw new Error(`Gemini CLI did not list the ${String(name)} extension.`)
    }
    return {
      skills: (extension.skills ?? []).map(skill =>
        typeof skill === 'string'
          ? skill
          : String((skill as { name?: unknown }).name),
      ),
      mcpUrls: collectUrls(extension.mcpServers),
    }
  },
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
  loadCheck: geminiLoadCheck,
})
