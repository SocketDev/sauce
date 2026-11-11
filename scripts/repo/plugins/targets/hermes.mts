/**
 * Hermes Agent (Nous Research): a portable Agent Plugins v1 package under
 * hermes/.
 *
 * Hermes clones the plugin's directory and scans every file in it, with a
 * file-count and size cap, so the plugin lives in its own small directory.
 * Hermes loads only skills/<name>/SKILL.md, one level deep, so every skill,
 * nested ones included, is copied byte for byte into its own top-level
 * directory. Hermes rejects symlinks that leave the plugin root, so skills
 * are copied, not linked.
 *
 * No mcp.json ships: an Agent Plugins v1 remote server entry accepts only
 * type, url and headers, so it cannot turn on OAuth, and the Socket MCP
 * server needs OAuth. hermes/README.md is hand-maintained.
 */

import { statSync } from 'node:fs'
import * as path from 'node:path'

import { findSkillNames, parseJsonOutput } from '../load.mts'
import { renderFormattedJson } from '../output.mts'
import { skillOwnFiles } from '../skills.mts'
import { SOCKET_MCP, WEBSITE_URL } from '../socket.mts'
import { definePluginTarget } from '../target.mts'
import type { LoadCheck, PluginInputs } from '../target.mts'

export const HERMES_DIR = 'hermes'
export const HERMES_MANIFEST = `${HERMES_DIR}/plugin.json`
export const HERMES_README = `${HERMES_DIR}/README.md`
export const HERMES_SKILLS = `${HERMES_DIR}/skills`
export const HERMES_ENTRIES = ['README.md', 'plugin.json', 'skills']

export const AGENT_PLUGINS_SCHEMA_V1 =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'

// Hermes names the install directory and every skill after this name, so
// skills show up as socket:socket-scan, socket:socket-inspect, and so on.
export const HERMES_PLUGIN_NAME = 'socket'

export const HERMES_MCP_ADD_COMMAND = `hermes mcp add ${SOCKET_MCP.name} --url ${SOCKET_MCP.url} --auth oauth`

// Agent Plugins v1 plugin names, as Hermes's loader checks them.
const PLUGIN_NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const MAX_NAME_LENGTH = 64

// Hermes's install scanner refuses a plugin over these caps.
export const HERMES_MAX_FILE_COUNT = 400
export const HERMES_MAX_TOTAL_BYTES = 10 * 1024 * 1024
export const HERMES_MAX_FILE_BYTES = 1024 * 1024

export function buildHermesManifest(
  ctx: PluginInputs,
): Record<string, unknown> {
  const { identity } = ctx
  return {
    $schema: AGENT_PLUGINS_SCHEMA_V1,
    name: HERMES_PLUGIN_NAME,
    version: identity.version,
    description: identity.description || undefined,
    author: identity.author
      ? { name: identity.author.name, url: WEBSITE_URL }
      : undefined,
    homepage: identity.homepage
      ? `${identity.homepage.replace(/\/+$/, '')}/tree/main/${HERMES_DIR}`
      : undefined,
    repository: identity.repository,
    license: identity.license,
    keywords: identity.keywords.includes('hermes')
      ? identity.keywords
      : [...identity.keywords, 'hermes'],
  }
}

/**
 * Every file hermes/skills/ must hold, keyed by path relative to it, valued
 * by source path. Each skill's own files go under its name; nested skills
 * get their own entry instead of riding along with their parent.
 */
export function hermesSkillFiles(ctx: PluginInputs): Map<string, string> {
  const files = new Map<string, string>()
  for (const skill of ctx.skills) {
    for (const { 0: rel, 1: source } of skillOwnFiles(skill)) {
      files.set(`${skill.name}/${rel}`, source)
    }
  }
  return files
}

export interface HermesLimitsOptions {
  extraBytes?: number | undefined
  extraFiles?: number | undefined
}

/**
 * Check a generated plugin against Hermes's plugin-name rule and install
 * scanner caps. Returns one message per problem.
 */
export function validateHermesPlugin(
  manifest: Record<string, unknown>,
  files: ReadonlyMap<string, string>,
  options?: HermesLimitsOptions | undefined,
): string[] {
  const { extraBytes = 0, extraFiles = 2 } = {
    __proto__: null,
    ...options,
  } as HermesLimitsOptions
  const problems: string[] = []
  const name = manifest['name']
  if (
    typeof name !== 'string' ||
    name.length > MAX_NAME_LENGTH ||
    !PLUGIN_NAME_RE.test(name)
  ) {
    problems.push(`plugin name ${JSON.stringify(name)} is not a valid v1 name`)
  }
  if (manifest['$schema'] !== AGENT_PLUGINS_SCHEMA_V1) {
    problems.push('plugin.json must declare the Agent Plugins v1 schema')
  }
  let totalBytes = extraBytes
  let fileCount = extraFiles
  for (const { 0: rel, 1: source } of files) {
    const bytes = statSync(source).size
    totalBytes += bytes
    fileCount += 1
    if (bytes > HERMES_MAX_FILE_BYTES) {
      problems.push(`skills/${rel} is ${bytes} bytes, over Hermes's 1MB cap`)
    }
  }
  if (fileCount > HERMES_MAX_FILE_COUNT) {
    problems.push(
      `plugin has ${fileCount} files, over Hermes's ${HERMES_MAX_FILE_COUNT}-file cap`,
    )
  }
  if (totalBytes > HERMES_MAX_TOTAL_BYTES) {
    problems.push(`plugin is ${totalBytes} bytes, over Hermes's 10MB cap`)
  }
  return problems
}

/**
 * Runs Hermes's own validator, then installs the plugin through Hermes's
 * clone-and-scan install path (the install scanner included) and reads the
 * skills it installed.
 */
export const hermesLoadCheck: LoadCheck = {
  cli: {
    bin: 'hermes',
    install: {
      tool: 'uv',
      spec: 'git+https://github.com/NousResearch/hermes-agent@bf0203a794a07aac3ff764972ab9087baa4e4f4e',
    },
    isolate: home => ({ HERMES_HOME: home }),
  },
  load(session) {
    session.run([
      'plugins',
      'validate',
      path.join(session.dir, HERMES_DIR),
      '--json',
    ])
    session.run([
      'plugins',
      'install',
      `${session.gitUrl()}#${HERMES_DIR}`,
      '--yes-deps',
      '--no-enable',
    ])
    const listed = parseJsonOutput(
      session.run(['plugins', 'list', '--json']),
    ) as Array<{ name: string }>
    if (!listed.some(p => p.name === HERMES_PLUGIN_NAME)) {
      throw new Error(`Hermes did not list the ${HERMES_PLUGIN_NAME} plugin.`)
    }
    return { skills: findSkillNames(session.home), mcpUrls: [] }
  },
}

export const hermesTarget = definePluginTarget({
  id: 'hermes',
  agent: 'Hermes Agent',
  files: [HERMES_MANIFEST],
  dirs: [HERMES_SKILLS],
  sources: [HERMES_README],
  connect: {
    bundlesServer: false,
    signIn: [
      {
        howTo:
          'Add the server first (below). Sign in again later with `hermes mcp login socket`.',
      },
    ],
    addServer: {
      intro:
        'In Hermes Agent, the Socket plugin does not add the server, so add it once with OAuth turned on. Hermes opens a browser to sign in. Then start a new session:',
      command: HERMES_MCP_ADD_COMMAND,
    },
  },
  generate(ctx) {
    const readme = path.join(ctx.root, HERMES_README)
    const manifest = buildHermesManifest(ctx)
    const manifestText = renderFormattedJson(manifest)
    const files = hermesSkillFiles(ctx)
    const problems = validateHermesPlugin(manifest, files, {
      extraBytes: Buffer.byteLength(manifestText) + statSync(readme).size,
    })
    if (problems.length > 0) {
      throw new Error(
        `Hermes would reject the generated plugin:\n${problems.map(p => `  - ${p}`).join('\n')}`,
      )
    }
    ctx.out.onlyEntries(HERMES_DIR, HERMES_ENTRIES)
    ctx.out.file(HERMES_MANIFEST, manifestText)
    ctx.out.tree(HERMES_SKILLS, files)
  },
  loadCheck: hermesLoadCheck,
})
