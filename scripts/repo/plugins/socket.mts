/**
 * What every plugin says about Socket. .claude-plugin/plugin.json is the
 * hand-maintained source for the name, version, and description (the release
 * workflow bumps its version); everything else here is a constant every
 * target reads instead of keeping its own copy.
 */

import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'

export const SOURCE_MANIFEST = '.claude-plugin/plugin.json'

export const DISPLAY_NAME = 'Socket'
export const WEBSITE_URL = 'https://socket.dev'
export const SHORT_DESCRIPTION =
  'Scan, inspect, patch, and fix dependencies with Socket security data'
export const DEFAULT_PROMPTS = [
  "Scan this project's dependencies with Socket.",
  'Check an npm package with Socket before I add it.',
  'Fix the vulnerable dependencies in this project.',
] as const

/**
 * The hosted Socket MCP server. It signs users in with OAuth (dynamic client
 * registration + PKCE against api.socket.dev), so no plugin ships an API key.
 * Every agent registers it under the same name, so its tools are named alike
 * everywhere.
 */
export const SOCKET_MCP = {
  name: 'socket',
  url: 'https://mcp.socket.dev/',
  scopes: ['packages:list', 'alerts:list', 'threat-feed:list'],
} as const

/**
 * An agent's `mcpServers` map holding only the Socket server, in whatever
 * entry shape that agent uses.
 */
export function socketMcpServers<T>(entry: T): Record<string, T> {
  return { [SOCKET_MCP.name]: entry }
}

/**
 * The skill whose job is connecting an agent to the MCP server.
 */
export const CONNECT_SKILL = 'socket-connect'

export interface PluginIdentity {
  name: string
  version: string
  description: string
  author: { name: string } | undefined
  homepage: string | undefined
  repository: string | undefined
  license: string | undefined
  keywords: string[]
}

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export function readPluginIdentity(root: string): PluginIdentity {
  const file = path.join(root, SOURCE_MANIFEST)
  if (!existsSync(file)) {
    throw new Error(`Missing required file: ${file}`)
  }
  const src = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
  const name = src['name']
  if (typeof name !== 'string' || !PLUGIN_NAME_RE.test(name)) {
    throw new Error(
      `Invalid plugin name in ${SOURCE_MANIFEST}: ${JSON.stringify(name)}. ` +
        `Must be lowercase and match ${PLUGIN_NAME_RE.source}`,
    )
  }
  const version = src['version']
  if (typeof version !== 'string' || !version) {
    throw new Error(`${SOURCE_MANIFEST} must define a non-empty 'version'`)
  }
  const author = src['author']
  const authorName =
    author && typeof author === 'object'
      ? (author as Record<string, unknown>)['name']
      : undefined
  const keywords = src['keywords']
  return {
    name,
    version,
    description: optionalString(src['description']) ?? '',
    author: typeof authorName === 'string' ? { name: authorName } : undefined,
    homepage: optionalString(src['homepage']),
    repository: optionalString(src['repository']),
    license: optionalString(src['license']),
    keywords: Array.isArray(keywords)
      ? keywords.filter((k): k is string => typeof k === 'string')
      : [],
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
