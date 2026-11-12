/**
 * Has each agent's own CLI load the plugin and checks what it reports: every
 * skill, and the Socket MCP server at the chosen endpoint. The plugin is a
 * local build in tmp/ (see local-build.mts), so this checks uncommitted
 * changes and can point at another Socket deployment through
 * SOCKET_MCP_URL / SOCKET_CLI_API_BASE_URL or .env.local. Every CLI runs with
 * its config in a fresh temporary directory.
 *
 * Node scripts/repo/plugins/load-check.mts [--target <id>] [--require]
 * node scripts/repo/plugins/load-check.mts --ci-matrix.
 *
 * Without --require, an agent whose CLI is not installed is skipped.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  describeEndpoints,
  loadLocalEnv,
  PRODUCTION_MCP_URL,
  redactEndpoints,
  resolveEndpoints,
} from './endpoint.mts'
import type { SocketEndpoints } from './endpoint.mts'
import { selectTargets } from './generate.mts'
import { buildLocalPlugin } from './local-build.mts'
import { PLUGIN_TARGETS } from './registry.mts'
import { discoverSkills } from './skills.mts'
import type { LoadReport, LoadSession, PluginTarget } from './target.mts'

export const LOAD_CHECK_DIR = 'tmp/plugins/load-check'

const RUN_TIMEOUT_MS = 180_000

// Variables an enclosing agent session or git hook sets that would change
// how a nested CLI or git behaves.
const INHERITED_ENV_RE = /^(?:CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|GIT_[A-Z_]+)$/

export type LoadStatus = 'passed' | 'failed' | 'skipped'

export interface LoadOutcome {
  readonly id: string
  readonly agent: string
  readonly status: LoadStatus
  readonly detail: string
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/'
    }
    return parsed.href
  } catch {
    return url
  }
}

/**
 * What is wrong with an agent's report: a skill it did not load, or an MCP
 * server that is missing or points somewhere other than the chosen endpoint.
 */
export function compareReport(
  target: PluginTarget,
  expectedSkills: readonly string[],
  report: LoadReport,
  endpoints: SocketEndpoints,
): string[] {
  const problems: string[] = []
  const loaded = new Set(report.skills)
  const missing = expectedSkills.filter(name => !loaded.has(name))
  if (missing.length > 0) {
    problems.push(
      `did not load ${missing.length} skill(s): ${missing.join(', ')}`,
    )
  }
  const urls = report.mcpUrls.map(normalizeUrl)
  if (target.connect.bundlesServer) {
    if (!urls.includes(endpoints.mcpUrl)) {
      problems.push(
        `did not register the Socket MCP server at ${endpoints.mcpUrl}`,
      )
    }
    if (!endpoints.isProduction && urls.includes(PRODUCTION_MCP_URL)) {
      problems.push('still registers the production MCP server')
    }
  }
  return problems
}

export function inheritedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !INHERITED_ENV_RE.test(key)),
  )
}

function commitBuild(dir: string, env: NodeJS.ProcessEnv): string {
  const git = (...args: string[]): void => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'user.name=Load Check',
        '-c',
        'user.email=load-check@example.invalid',
        ...args,
      ],
      { cwd: dir, env, encoding: 'utf8' },
    )
    if (result.status !== 0) {
      throw new Error(`git ${args[0]} failed in the build: ${result.stderr}`)
    }
  }
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'plugin build')
  return pathToFileURL(dir).href
}

export interface RunLoadOptions {
  readonly require?: boolean | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
}

export function runTargetLoadCheck(
  target: PluginTarget,
  dir: string,
  endpoints: SocketEndpoints,
  options?: RunLoadOptions | undefined,
): LoadOutcome {
  const { require = false, env: baseEnv = process.env } = {
    __proto__: null,
    ...options,
  } as RunLoadOptions
  const base = { id: target.id, agent: target.agent }
  const check = target.loadCheck
  if (!check) {
    return {
      ...base,
      status: 'skipped',
      detail: 'no CLI that loads this plugin',
    }
  }
  const { bin } = check.cli
  const home = mkdtempSync(path.join(os.tmpdir(), `load-check-${target.id}-`))
  try {
    const env = { ...inheritedEnv(baseEnv), ...check.cli.isolate(home) }
    const probe = spawnSync(bin, ['--version'], {
      env,
      encoding: 'utf8',
      input: '',
      timeout: RUN_TIMEOUT_MS,
    })
    if (probe.error || probe.status !== 0) {
      return {
        ...base,
        status: require ? 'failed' : 'skipped',
        detail: `\`${bin}\` is not installed (CI installs ${check.cli.install.spec})`,
      }
    }
    let gitUrl: string | undefined
    const session: LoadSession = {
      dir,
      home,
      gitUrl: () => (gitUrl ??= commitBuild(dir, inheritedEnv(baseEnv))),
      run(args, runOptions) {
        const result = spawnSync(bin, args, {
          cwd: runOptions?.cwd ?? home,
          env,
          encoding: 'utf8',
          input: '',
          maxBuffer: 64 * 1024 * 1024,
          timeout: RUN_TIMEOUT_MS,
        })
        if (result.error || result.status !== 0) {
          throw new Error(
            `\`${bin} ${args.join(' ')}\` ${result.error ? `failed: ${result.error.message}` : `exited ${result.status}`}\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd(),
          )
        }
        return result.stdout
      },
    }
    const report = check.load(session)
    const expected = discoverSkills(dir).map(skill => skill.name)
    const problems = compareReport(target, expected, report, endpoints)
    if (problems.length > 0) {
      return { ...base, status: 'failed', detail: problems.join('; ') }
    }
    return {
      ...base,
      status: 'passed',
      detail: `loaded ${expected.length} skills${target.connect.bundlesServer ? ' and the Socket MCP server' : ''}`,
    }
  } catch (e) {
    return { ...base, status: 'failed', detail: (e as Error).message }
  } finally {
    safeDeleteSync(home)
  }
}

export interface CiMatrixEntry {
  readonly id: string
  readonly agent: string
  readonly bin: string
  readonly tool: string
  readonly spec: string
}

export function ciMatrix(
  targets: readonly PluginTarget[] = PLUGIN_TARGETS,
): CiMatrixEntry[] {
  return targets.flatMap(target =>
    target.loadCheck
      ? [
          {
            id: target.id,
            agent: target.agent,
            bin: target.loadCheck.cli.bin,
            tool: target.loadCheck.cli.install.tool,
            spec: target.loadCheck.cli.install.spec,
          },
        ]
      : [],
  )
}

const MARK: Record<LoadStatus, string> = {
  passed: 'ok  ',
  failed: 'FAIL',
  skipped: 'skip',
}

export function formatOutcome(
  outcome: LoadOutcome,
  endpoints: SocketEndpoints,
): string {
  return redactEndpoints(
    `${MARK[outcome.status]} ${outcome.agent}: ${outcome.detail}`,
    endpoints,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
  )
  const args = process.argv.slice(2)
  if (args.includes('--ci-matrix')) {
    process.stdout.write(`${JSON.stringify(ciMatrix())}\n`)
  } else {
    let endpoints: SocketEndpoints | undefined
    try {
      loadLocalEnv(root)
      endpoints = resolveEndpoints()
      const targets = selectTargets(args)
      const build = buildLocalPlugin(root, LOAD_CHECK_DIR, endpoints)
      process.stdout.write(
        `Loading the plugin build into each agent, pointed at ${describeEndpoints(endpoints)}.\n`,
      )
      let failed = false
      for (const target of targets) {
        const outcome = runTargetLoadCheck(target, build.dir, endpoints, {
          require: args.includes('--require'),
        })
        failed ||= outcome.status === 'failed'
        process.stdout.write(`${formatOutcome(outcome, endpoints)}\n`)
      }
      process.exitCode = failed ? 1 : 0
    } catch (e) {
      const message = (e as Error).message
      process.stderr.write(
        `${endpoints ? redactEndpoints(message, endpoints) : message}\n`,
      )
      process.exitCode = 1
    }
  }
}
