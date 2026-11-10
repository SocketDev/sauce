/**
 * OpenAI Codex. The plugin root is skills/, not the repo root: Codex copies
 * the whole plugin root into its cache on install, and skills/ is the only
 * shipped content Codex needs. Codex ignores manifest paths that do not
 * start with './', and rejects a bare './' skills path, so the top-level
 * skill directories are listed; Codex finds nested skills by scanning them.
 * The MCP config is never named .mcp.json, which is the fleet's MCP
 * inventory and gitignored at every depth.
 */

import {
  DEFAULT_PROMPTS,
  DISPLAY_NAME,
  SHORT_DESCRIPTION,
  SOCKET_MCP,
  socketMcpServers,
  WEBSITE_URL,
} from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { PluginInputs } from '../target.mts'

export const CODEX_MANIFEST = 'skills/.codex-plugin/plugin.json'
export const CODEX_MCP = 'skills/.codex-plugin/mcp.json'
export const CODEX_MARKETPLACE = '.agents/plugins/marketplace.json'

const CATEGORY = 'Developer Tools'

export function codexSkillRoots(ctx: PluginInputs): string[] {
  return ctx.skills
    .filter(skill => skill.parent === undefined)
    .map(skill => `./${skill.relDir}`)
}

export function buildCodexManifest(ctx: PluginInputs): Record<string, unknown> {
  const { identity } = ctx
  return {
    name: identity.name,
    version: identity.version,
    description: identity.description,
    keywords: identity.keywords,
    skills: codexSkillRoots(ctx),
    mcpServers: './.codex-plugin/mcp.json',
    interface: {
      displayName: DISPLAY_NAME,
      shortDescription: SHORT_DESCRIPTION,
      longDescription: identity.description,
      developerName: identity.author?.name,
      category: CATEGORY,
      capabilities: ['Read', 'Write'],
      websiteURL: WEBSITE_URL,
      defaultPrompt: [...DEFAULT_PROMPTS],
    },
  }
}

export function buildCodexMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: socketMcpServers({
      type: 'http',
      url: SOCKET_MCP.url,
      scopes: [...SOCKET_MCP.scopes],
    }),
  }
}

export function buildCodexMarketplace(
  ctx: PluginInputs,
): Record<string, unknown> {
  const { name } = ctx.identity
  return {
    name,
    interface: { displayName: DISPLAY_NAME },
    plugins: [
      {
        name,
        source: { source: 'local', path: './skills' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: CATEGORY,
      },
    ],
  }
}

export const codexTarget = definePluginTarget({
  id: 'codex',
  agent: 'Codex',
  files: [CODEX_MANIFEST, CODEX_MCP, CODEX_MARKETPLACE],
  dirs: [],
  sources: [],
  connect: {
    bundlesServer: true,
    signIn: [
      {
        howTo:
          'Run `/mcp login socket`, or `codex mcp login socket` from a shell. Add `--no-browser` over SSH.',
      },
    ],
  },
  generate(ctx) {
    ctx.out.json(CODEX_MANIFEST, buildCodexManifest(ctx))
    ctx.out.json(CODEX_MCP, buildCodexMcpConfig())
    ctx.out.json(CODEX_MARKETPLACE, buildCodexMarketplace(ctx))
  },
})
