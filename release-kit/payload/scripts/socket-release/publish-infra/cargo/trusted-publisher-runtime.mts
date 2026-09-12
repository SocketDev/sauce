import { promises as fs } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { httpJson, HttpResponseError } from '@socketsecurity/lib/http-request'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { parseGitHubSlug } from '../pin-readme.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import {
  CARGO_PUBLISH_WORKFLOW_BASENAMES,
  describeHttpFailure,
  environmentProblem,
  extractCratesIoErrorDetail,
  formatConfig,
  isValidWorkflowFilename,
  matchesTarget,
  pickCargoPublishWorkflow,
  TRUSTPUB_GITHUB_CONFIGS_URL,
} from './trusted-publisher-shape.mts'
import type {
  GitHubConfigRow,
  RunTrustedPublisherOptions,
  TrustedPublisherResult,
  TrustedPublisherStatus,
  TrustedPublisherTarget,
  WorkflowSurface,
} from './trusted-publisher-shape.mts'

const USER_AGENT = 'socket-release-kit-publish (github.com/SocketDev/sauce)'
const REQUEST_TIMEOUT_MS = 20_000

// The headers every authenticated crates.io call carries. crates.io takes the
// raw token in `authorization` (no `Bearer` prefix) and 403s a request with no
// descriptive User-Agent.
function authHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: token,
    'user-agent': USER_AGENT,
  }
}

// Re-throw an HTTP failure as an actionable Error; anything else passes
// through unchanged so a network error keeps its own message.
function rethrowActionable(e: unknown): never {
  if (e instanceof HttpResponseError) {
    const detail = extractCratesIoErrorDetail(e.response.body.toString('utf8'))
    throw new Error(describeHttpFailure(e.response.status, detail))
  }
  throw e
}

/**
 * Every trusted-publisher config crates.io stores for `crate`. Requires a token
 * with the `trusted-publishing` scope and ownership of the crate.
 */
export async function listGitHubConfigs(
  crate: string,
  token: string,
): Promise<GitHubConfigRow[]> {
  const url = `${TRUSTPUB_GITHUB_CONFIGS_URL}?crate=${encodeURIComponent(crate)}`
  try {
    const json = await httpJson<{
      github_configs?: GitHubConfigRow[] | undefined
    }>(url, { headers: authHeaders(token), timeout: REQUEST_TIMEOUT_MS })
    return Array.isArray(json.github_configs) ? json.github_configs : []
  } catch (e) {
    return rethrowActionable(e)
  }
}

/**
 * Store one trusted-publisher config for `crate`. crates.io caps a crate at 5
 * configs and rejects a duplicate, so callers list first.
 */
export async function createGitHubConfig(
  crate: string,
  target: TrustedPublisherTarget,
  token: string,
): Promise<GitHubConfigRow> {
  try {
    const json = await httpJson<{
      github_config?: GitHubConfigRow | undefined
    }>(TRUSTPUB_GITHUB_CONFIGS_URL, {
      body: JSON.stringify({
        github_config: {
          crate,
          // crates.io models "no environment gate" as an explicit JSON null;
          // omitting the key is a different request to the registry, whose
          // own schema types this field as string|null.
          // oxlint-disable-next-line socket/prefer-undefined-over-null -- registry wire schema
          environment: target.environment ?? null,
          repository_name: target.repositoryName,
          repository_owner: target.repositoryOwner,
          workflow_filename: target.workflowFilename,
        },
      }),
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      method: 'POST',
      timeout: REQUEST_TIMEOUT_MS,
    })
    if (!json.github_config) {
      throw new Error(
        'crates.io accepted the request but returned no `github_config`.',
      )
    }
    return json.github_config
  } catch (e) {
    return rethrowActionable(e)
  }
}

/**
 * The checkout every derivation reads: the `--path` value resolved against the
 * caller's `cwd`, so a relative path means what the operator typed it from, or
 * this script's own repo root when `--path` is absent. Cascaded copies pass
 * nothing and keep inspecting their own checkout. Pure — exported for tests.
 */
export function resolveInspectedRoot(
  pathArg: string | undefined,
  cwd: string,
): string {
  return pathArg === undefined ? rootPath : path.resolve(cwd, pathArg)
}

/**
 * Whether `value` is shaped like a GitHub `owner/name` slug: two path-free
 * segments, each starting alphanumeric. The leading-character rule is what
 * separates a slug from `./widgets`, `../widgets`, `~/widgets`, and `/widgets`.
 * Pure — exported for tests.
 */
export function isGitHubSlugShape(value: string): boolean {
  return /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(normalizePath(value))
}

/**
 * The refusal for a `--repo` value that is really a filesystem path, or
 * undefined when the value can be read as a GitHub slug. `--repo` names the
 * `owner/name` a stored config points at; `--path` names the checkout to
 * inspect. A path handed to `--repo` would store a config whose OIDC claim
 * nothing ever matches, so it refuses instead. The caller answers the
 * directory-existence question, which keeps this pure — exported for tests.
 */
export function repoFlagMisuse(
  value: string,
  options?: { isExistingDir?: boolean | undefined } | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options } as {
    isExistingDir?: boolean | undefined
  }
  const normalized = normalizePath(value)
  const looksLikePath =
    normalized.startsWith('.') ||
    normalized.startsWith('/') ||
    normalized.startsWith('~')
  if (!looksLikePath && !opts.isExistingDir) {
    return undefined
  }
  return (
    '[cargo-trustpub] --repo takes a GitHub owner/name, not a filesystem ' +
    `path. Where: the --repo argument. Saw: ${value} ` +
    `(${looksLikePath ? 'a path-shaped value' : 'an existing directory'}); ` +
    'wanted: owner/name, for example acme/widgets. Fix: pass ' +
    `--path ${value} to inspect that checkout instead.`
  )
}

/**
 * The refusal for a `--path` value that is really a GitHub slug, or undefined
 * when the value can be read as a directory. A slug handed to `--path` would
 * resolve to an unrelated directory under the caller's cwd, so it refuses. A
 * value that is neither an existing directory nor slug-shaped passes through to
 * the workflow-directory reader, which already names the path it could not
 * read. The caller answers the directory-existence question, which keeps this
 * pure — exported for tests.
 */
export function pathFlagMisuse(
  value: string,
  options?: { isExistingDir?: boolean | undefined } | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options } as {
    isExistingDir?: boolean | undefined
  }
  if (opts.isExistingDir || !isGitHubSlugShape(value)) {
    return undefined
  }
  return (
    '[cargo-trustpub] --path takes a directory, not a GitHub owner/name. ' +
    `Where: the --path argument. Saw: ${value} (slug-shaped, and no such ` +
    'directory); wanted: the checkout to inspect, for example ' +
    `../widgets. Fix: pass --repo ${value} to override the stored ` +
    'owner/name instead.'
  )
}

/**
 * The `owner/repo` slug of the checkout at `cwd`, read from its `origin`
 * remote. Throws LOUD when git fails or the remote is not a GitHub URL — a
 * guessed slug would store a config that silently never matches an OIDC claim.
 */
export async function resolveRepoSlug(cwd: string): Promise<string> {
  const { code, stdout } = await runCapture(
    'git',
    ['remote', 'get-url', 'origin'],
    cwd,
  )
  const slug = code === 0 ? parseGitHubSlug(stdout.trim()) : undefined
  if (!slug) {
    throw new Error(
      '[cargo-trustpub] could not resolve the GitHub repository. Where: the ' +
        `\`origin\` remote of ${cwd}. Saw: ` +
        `${code === 0 ? `a non-GitHub remote (${stdout.trim() || 'empty'})` : `git exited ${code}`}; ` +
        'wanted: a github.com owner/repo URL. Fix: point --path <dir> at the ' +
        'right checkout, or pass --repo <owner/name>.',
    )
  }
  return slug
}

/**
 * The workflow filename + environment the repo's cargo-publish job actually
 * uses. Throws LOUD when the repo has no cargo-publish workflow — configuring
 * a trusted publisher against a workflow that does not exist produces a config
 * whose OIDC exchange fails at publish time, long after this script reported
 * success.
 */
export async function readCargoPublishSurface(
  workflowsDir: string,
): Promise<WorkflowSurface> {
  let entries: string[]
  try {
    entries = await fs.readdir(workflowsDir)
  } catch {
    throw new Error(
      '[cargo-trustpub] could not read the workflows directory. Where: ' +
        `${workflowsDir}. Saw: missing or unreadable; wanted: a ` +
        'cargo-publish workflow to derive the trusted-publisher target from. ' +
        'Fix: point --path <dir> at a repo that has ' +
        '.github/workflows/cargo-publish.yml, or pass --workflow <file.yml> ' +
        '--environment <name>.',
    )
  }
  const workflowFilename = pickCargoPublishWorkflow(entries)
  if (!workflowFilename) {
    throw new Error(
      '[cargo-trustpub] this repo has no cargo-publish workflow. Where: ' +
        `${workflowsDir}. Saw: none of ` +
        `${CARGO_PUBLISH_WORKFLOW_BASENAMES.join(' / ')}; wanted: the ` +
        'workflow whose OIDC claim crates.io will match. Fix: cascade the ' +
        'cargo-publish workflow into that repo first, point --path <dir> at ' +
        'the repo you meant, or pass --workflow <file.yml> ' +
        '--environment <name>.',
    )
  }
  const workflowText = await fs.readFile(
    path.join(workflowsDir, workflowFilename),
    'utf8',
  )
  return {
    environment: extractWorkflowEnvironment(workflowText),
    workflowFilename,
  }
}

/**
 * Assemble the target every crate is configured against, from the repo slug and
 * the workflow surface, with any CLI override applied last. Throws LOUD when a
 * field would not survive crates.io's own validators. Pure — exported for
 * tests.
 */
export function buildTrustedPublisherTarget(
  slug: string,
  surface: WorkflowSurface,
  overrides?:
    | { environment?: string | undefined; workflow?: string | undefined }
    | undefined,
): TrustedPublisherTarget {
  const over = { __proto__: null, ...overrides } as {
    environment?: string | undefined
    workflow?: string | undefined
  }
  const { 0: repositoryOwner, 1: repositoryName } = slug.split('/')
  if (!repositoryOwner || !repositoryName) {
    throw new Error(
      `[cargo-trustpub] the repository slug is malformed. Saw: ${slug}; ` +
        'wanted: owner/name. Fix: pass --repo <owner/name>.',
    )
  }
  const workflowFilename = over.workflow ?? surface.workflowFilename
  if (!isValidWorkflowFilename(workflowFilename)) {
    throw new Error(
      '[cargo-trustpub] the workflow filename is not storable on crates.io. ' +
        `Saw: ${workflowFilename}; wanted: a bare basename ending in .yml or ` +
        '.yaml. Fix: pass --workflow <file.yml>.',
    )
  }
  const environment = over.environment ?? surface.environment
  if (environment !== undefined) {
    const problem = environmentProblem(environment)
    if (problem !== undefined) {
      throw new Error(
        `[cargo-trustpub] the environment name ${problem}. Saw: ` +
          `${JSON.stringify(environment)}; wanted: the CI environment the ` +
          'publish job runs in. Fix: pass --environment <name>.',
      )
    }
  }
  return { environment, repositoryName, repositoryOwner, workflowFilename }
}

/**
 * One-line human summary of the run: counts by status, tagged with the mode.
 * Pure — exported for tests.
 */
export function formatSummary(
  results: readonly TrustedPublisherResult[],
  config: { apply: boolean },
): string {
  const cfg = { __proto__: null, ...config } as { apply: boolean }
  const count = (status: TrustedPublisherStatus): number =>
    results.filter(r => r.status === status).length
  return (
    `Trusted-publisher ${cfg.apply ? 'apply' : 'dry-run'} summary: ` +
    `${count('created')} created, ${count('planned')} planned, ` +
    `${count('unchanged')} unchanged, ${count('skipped')} skipped, ` +
    `${count('failed')} failed.`
  )
}

/**
 * Configure each crate, isolated. For every crate: list its stored configs (an
 * exact match → unchanged), then either PRINT the plan (dry-run) or create the
 * config (`--apply`). A thrown error for one crate is recorded as `failed` and
 * never aborts the others. Logs a summary and returns the per-crate results
 * (for tests + the caller's exit-code decision).
 */
export async function runTrustedPublisher(
  crates: readonly string[],
  target: TrustedPublisherTarget,
  config: { apply: boolean; token: string },
  options?: RunTrustedPublisherOptions | undefined,
): Promise<TrustedPublisherResult[]> {
  const cfg = { __proto__: null, ...config } as {
    apply: boolean
    token: string
  }
  const opts = { __proto__: null, ...options } as RunTrustedPublisherOptions
  const listConfigs = opts.listConfigs ?? listGitHubConfigs
  const createConfig = opts.createConfig ?? createGitHubConfig

  const results: TrustedPublisherResult[] = []
  for (let i = 0, { length } = crates; i < length; i += 1) {
    const crate = crates[i]!
    try {
      // eslint-disable-next-line no-await-in-loop
      const rows = await listConfigs(crate, cfg.token)
      if (rows.some(row => matchesTarget(row, target))) {
        logger.substep(`${formatConfig(crate, target)} — already configured`)
        results.push({ crate, status: 'unchanged' })
        continue
      }
      if (!cfg.apply) {
        logger.substep(`[dry-run] would create ${formatConfig(crate, target)}`)
        results.push({ crate, status: 'planned' })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const created = await createConfig(crate, target, cfg.token)
      logger.success(
        `Configured ${formatConfig(crate, target)} (config #${created.id}).`,
      )
      results.push({ crate, status: 'created' })
    } catch (e) {
      logger.error(`${crate}: ${errorMessage(e)}`)
      results.push({ crate, status: 'failed', detail: errorMessage(e) })
    }
  }

  logger.log('')
  logger.log(formatSummary(results, { apply: cfg.apply }))
  return results
}
