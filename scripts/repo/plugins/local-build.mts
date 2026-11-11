/**
 * Copies the shipped plugin tree into tmp/ (gitignored) and points the copy at
 * the Socket deployment chosen by SOCKET_MCP_URL and SOCKET_CLI_API_BASE_URL
 * (from the environment or .env.local). With neither set, the copy points at
 * production. Agents load the copy, so the tracked files never change.
 *
 * Node scripts/repo/plugins/local-build.mts [--out <dir>]
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  SHIPPED_DIRS,
  SHIPPED_ROOT_FILES,
} from '../constants/shipped-surfaces.mts'
import {
  describeEndpoints,
  loadLocalEnv,
  PRODUCTION_API_URL,
  PRODUCTION_MCP_URL,
  redactEndpoints,
  resolveEndpoints,
} from './endpoint.mts'
import type { SocketEndpoints } from './endpoint.mts'

export const DEFAULT_OUT_DIR = 'tmp/plugins/local'

const SHIPPED_TOP_LEVEL = new Set([...SHIPPED_DIRS, ...SHIPPED_ROOT_FILES])

/**
 * Tracked and untracked (not ignored) files under the shipped surfaces, so a
 * skill that is not committed yet is still tested.
 */
export function listShippedFiles(root: string): string[] {
  const listed = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
  if (listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.trim()}`)
  }
  return [
    ...new Set(
      listed.stdout
        .split('\0')
        .filter(rel => rel && SHIPPED_TOP_LEVEL.has(rel.split('/')[0]!)),
    ),
  ].toSorted()
}

export function pointAtEndpoints(
  text: string,
  endpoints: SocketEndpoints,
): string {
  return text
    .replaceAll(PRODUCTION_MCP_URL, endpoints.mcpUrl)
    .replaceAll(PRODUCTION_API_URL, endpoints.apiUrl)
}

export interface LocalBuild {
  readonly dir: string
  readonly files: number
  readonly rewritten: number
}

export function buildLocalPlugin(
  root: string,
  outDir: string,
  endpoints: SocketEndpoints,
): LocalBuild {
  const dir = path.resolve(root, outDir)
  const relative = path.relative(root, dir)
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !relative.split(path.sep).includes('tmp')
  ) {
    throw new Error(
      'The local build must go in a tmp/ directory inside the repository, which git ignores.',
    )
  }
  safeDeleteSync(dir)
  const files = listShippedFiles(root)
  let rewritten = 0
  for (const rel of files) {
    const from = path.join(root, rel)
    const to = path.join(dir, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    if (lstatSync(from).isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to)
      continue
    }
    const bytes = readFileSync(from)
    if (endpoints.isProduction || bytes.includes(0)) {
      copyFileSync(from, to)
      continue
    }
    const text = bytes.toString('utf8')
    const next = pointAtEndpoints(text, endpoints)
    if (next !== text) {
      rewritten += 1
    }
    writeFileSync(to, next)
  }
  return { dir, files: files.length, rewritten }
}

function parseOut(argv: readonly string[]): string {
  const index = argv.indexOf('--out')
  if (index === -1) {
    return DEFAULT_OUT_DIR
  }
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error('--out needs a directory.')
  }
  return value
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
  )
  let endpoints: SocketEndpoints | undefined
  try {
    loadLocalEnv(root)
    endpoints = resolveEndpoints()
    const build = buildLocalPlugin(
      root,
      parseOut(process.argv.slice(2)),
      endpoints,
    )
    process.stdout.write(
      `Built ${build.files} plugin files in ${path.relative(root, build.dir)} for ${describeEndpoints(endpoints)}` +
        (endpoints.isProduction
          ? '.\n'
          : ` (${build.rewritten} files rewritten).\n`),
    )
  } catch (e) {
    const message = (e as Error).message
    process.stderr.write(
      `${endpoints ? redactEndpoints(message, endpoints) : message}\n`,
    )
    process.exitCode = 1
  }
}
