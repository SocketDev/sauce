/**
 * Gemini CLI. The extension loads agents/README.md as its context file and
 * registers the hosted MCP server.
 */

import { realpathSync } from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { collectUrls, readJson } from '../load.mts'
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

export interface GeminiSkillList {
  readonly skills: string[]
  readonly errors: string[]
}

/**
 * Reads `gemini skills list` output: the skills discovered under the
 * extension's directory, and every error Gemini CLI logged while loading
 * extensions.
 */
export function parseGeminiSkillList(
  output: string,
  extensionDirs: readonly string[],
): GeminiSkillList {
  const lines = stripVTControlCharacters(output).split('\n')
  const skills: string[] = []
  const errors: string[] = []
  let current: string | undefined
  for (const line of lines) {
    const heading = /^(\S+) \[(?:Enabled|Disabled)\]/.exec(line)
    if (heading) {
      current = heading[1]
      continue
    }
    const location = /^\s+Location:\s+(.+)$/.exec(line)
    if (location && current) {
      const file = path.resolve(location[1]!.trim())
      if (extensionDirs.some(dir => file.startsWith(dir + path.sep))) {
        skills.push(current)
      }
      current = undefined
      continue
    }
    if (/^\[\w+\] Error\b/.test(line)) {
      errors.push(line)
    }
  }
  return { skills, errors }
}

/**
 * Validates and installs the build as a Gemini CLI extension, then lists the
 * skills Gemini CLI discovered in it and reads the MCP servers from the
 * manifest it installed. The build folder is trusted through the
 * environment, since the install otherwise asks. Errors Gemini CLI logs
 * while loading the extension are reported.
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
    const extensionDir = path.join(
      session.home,
      '.gemini',
      'extensions',
      String(name),
    )
    const { skills, errors } = parseGeminiSkillList(
      session.run(['skills', 'list'], { stream: 'both' }),
      [extensionDir, realpathSync(extensionDir)],
    )
    const installed = readJson(path.join(extensionDir, GEMINI_MANIFEST))
    return { skills, mcpUrls: collectUrls(installed['mcpServers']), errors }
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
