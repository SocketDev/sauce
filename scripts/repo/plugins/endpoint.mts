/**
 * Which Socket deployment a local test run talks to. Production is the
 * default and the only deployment named in this repository. Another
 * deployment comes only from the environment or from the gitignored
 * .env.local, so its address never lands in a tracked file, a generated
 * artifact, or log output.
 *
 * Generation never reads these variables: committed plugin files always name
 * production.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { SOCKET_MCP } from './socket.mts'

export const LOCAL_ENV_FILE = '.env.local'

export const MCP_URL_ENV = 'SOCKET_MCP_URL'
export const API_URL_ENV = 'SOCKET_CLI_API_BASE_URL'

export const PRODUCTION_MCP_URL: string = SOCKET_MCP.url
export const PRODUCTION_API_URL = 'https://api.socket.dev/'

/**
 * Hosts under socket.dev that are public. Any other socket.dev host in a
 * tracked file is flagged by the content scan.
 */
export const PUBLIC_SOCKET_HOSTS: readonly string[] = [
  'api.socket.dev',
  'docs.socket.dev',
  'mcp.socket.dev',
  'socket.dev',
  'www.socket.dev',
]

export interface SocketEndpoints {
  readonly mcpUrl: string
  readonly apiUrl: string
  readonly isProduction: boolean
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

/**
 * Parses an endpoint override. It must be https, or http on a loopback host.
 * The error never echoes the value.
 */
export function parseEndpoint(name: string, value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is not a valid URL.`)
  }
  const secure =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && isLoopback(url.hostname))
  if (!secure) {
    throw new Error(
      `${name} must use https, or http on localhost or a loopback address.`,
    )
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${name} must not carry credentials, a query string, or a fragment.`,
    )
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/'
  }
  return url.href
}

/**
 * Loads the gitignored .env.local into process.env without overriding
 * variables that are already set.
 */
export function loadLocalEnv(root: string): boolean {
  const file = path.join(root, LOCAL_ENV_FILE)
  if (!existsSync(file)) {
    return false
  }
  process.loadEnvFile(file)
  return true
}

export function resolveEndpoints(
  env: NodeJS.ProcessEnv = process.env,
): SocketEndpoints {
  const mcpRaw = env[MCP_URL_ENV]?.trim()
  const apiRaw = env[API_URL_ENV]?.trim()
  const mcpUrl = mcpRaw
    ? parseEndpoint(MCP_URL_ENV, mcpRaw)
    : PRODUCTION_MCP_URL
  const apiUrl = apiRaw
    ? parseEndpoint(API_URL_ENV, apiRaw)
    : PRODUCTION_API_URL
  return {
    mcpUrl,
    apiUrl,
    isProduction:
      mcpUrl === PRODUCTION_MCP_URL && apiUrl === PRODUCTION_API_URL,
  }
}

/**
 * A label for output that never names a non-production deployment.
 */
export function describeEndpoints(endpoints: SocketEndpoints): string {
  return endpoints.isProduction
    ? 'production'
    : `the deployment set in ${MCP_URL_ENV} / ${API_URL_ENV}`
}

/**
 * The hosts of every non-production override, for the content scan.
 */
export function privateHosts(endpoints: SocketEndpoints): string[] {
  const hosts = new Set<string>()
  for (const url of [endpoints.mcpUrl, endpoints.apiUrl]) {
    const { hostname } = new URL(url)
    if (!PUBLIC_SOCKET_HOSTS.includes(hostname) && !isLoopback(hostname)) {
      hosts.add(hostname)
    }
  }
  return [...hosts].toSorted()
}

/**
 * Replaces every non-production endpoint in text with the name of its
 * variable, so logs and error messages never reveal it.
 */
export function redactEndpoints(
  text: string,
  endpoints: SocketEndpoints,
): string {
  let out = text
  const pairs: Array<[string, string, string]> = [
    [endpoints.mcpUrl, PRODUCTION_MCP_URL, MCP_URL_ENV],
    [endpoints.apiUrl, PRODUCTION_API_URL, API_URL_ENV],
  ]
  for (const { 0: url, 1: production, 2: name } of pairs) {
    if (url === production) {
      continue
    }
    const { host } = new URL(url)
    out = out.replaceAll(url, `<${name}>`).replaceAll(host, `<${name}>`)
  }
  return out
}
