#!/usr/bin/env node
/**
 * @file Crates.io Trusted Publishing (GitHub Actions OIDC) configuration for
 *   the workspace's crates. A crates.io trusted publisher binds a crate to one
 *   `owner/repo` + workflow filename + CI environment; the publish job then
 *   exchanges its OIDC token for a short-lived registry token instead of
 *   carrying a long-lived secret. The registry only accepts the exchange when
 *   the claim matches a stored config EXACTLY, so a config naming a workflow
 *   the repo does not have fails at publish time, not at configure time. Every
 *   field is therefore DERIVED, never assumed: the `owner/repo` comes from the
 *   checkout's `origin` remote, and the workflow filename + environment come
 *   from the repo's ACTUAL cargo-publish workflow (the `environment:` key,
 *   including the fleet's `${{ inputs.publish == true && 'cargo-publish' || ''
 *   }}` conditional form). The npm twin shipped hard-coded names once and
 *   configured every package to trust a workflow that did not exist; the OIDC
 *   exchange then 404'd on the first real publish. CLI: trusted-publisher
 *   [<crate>…] [--apply] [--path <dir>] [--repo <owner/name>] [--workflow
 *   <file.yml>] [--environment <name>] With no crate names, every publishable
 *   crate in the workspace is targeted. `--path <dir>` points all three
 *   derivations — the `origin` slug read, the
 *   `.github/workflows/cargo-publish.{yml,yaml}` lookup, and `cargo metadata`
 *   crate discovery — at another checkout, so one copy of this script can
 *   configure any repo; it defaults to the checkout the script lives in.
 *   `--repo <owner/name>` is the separate override for the GitHub slug a config
 *   is stored under, and each flag REFUSES a value shaped like the other's so a
 *   mix-up says which flag to use instead of resolving somewhere unrelated.
 *   Dry-run by default, prints the plan, writes nothing; `--apply` creates the
 *   missing configs. Per-crate isolation: one crate failing never aborts the
 *   rest, and a summary prints at the end. Fail-soft — main() catches, logs,
 *   and sets a non-zero exit code; it never throws. Auth: a crates.io API token
 *   carrying the `trusted-publishing` endpoint scope, read from
 *   `CARGO_REGISTRY_TOKEN` or `~/.cargo/credentials.toml`. The token is sent in
 *   the `authorization` header and never printed or passed on a command line.
 *   Usage: node
 *   scripts/socket-release/publish-infra/cargo/trusted-publisher.mts [--path
 *   <dir>] --apply.
 */

import { statSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { socketReleaseWorkflowsPath } from '../../paths.mts'
import { logger } from '../shared.mts'
import { cargoTokenProblem, resolveCratesToken } from './placeholder.mts'
import { readPublishableCargoPackages } from './shared.mts'
import {
  buildTrustedPublisherTarget,
  pathFlagMisuse,
  readCargoPublishSurface,
  repoFlagMisuse,
  resolveInspectedRoot,
  resolveRepoSlug,
  runTrustedPublisher,
} from './trusted-publisher-runtime.mts'
import type { TrustedPublisherArgs } from './trusted-publisher-shape.mts'

export {
  buildTrustedPublisherTarget,
  createGitHubConfig,
  formatSummary,
  isGitHubSlugShape,
  listGitHubConfigs,
  pathFlagMisuse,
  readCargoPublishSurface,
  repoFlagMisuse,
  resolveInspectedRoot,
  resolveRepoSlug,
  runTrustedPublisher,
} from './trusted-publisher-runtime.mts'
export {
  CARGO_PUBLISH_WORKFLOW_BASENAMES,
  describeHttpFailure,
  environmentProblem,
  extractCratesIoErrorDetail,
  extractWorkflowEnvironment,
  formatConfig,
  isValidWorkflowFilename,
  matchesTarget,
  pickCargoPublishWorkflow,
  TRUSTPUB_GITHUB_CONFIGS_URL,
  unwrapEnvironmentValue,
} from './trusted-publisher-shape.mts'
export type {
  GitHubConfigRow,
  RunTrustedPublisherOptions,
  TrustedPublisherArgs,
  TrustedPublisherResult,
  TrustedPublisherStatus,
  TrustedPublisherTarget,
  WorkflowSurface,
} from './trusted-publisher-shape.mts'

// The value-taking flags, so the parser reads one argument after each.
const VALUE_FLAGS = ['--environment', '--path', '--repo', '--workflow']

/**
 * Parse `trusted-publisher [<crate>…] [--apply] [--path <dir>]
 * [--repo <owner/name>] [--workflow <file.yml>] [--environment <name>]`.
 * Dry-run is the default (no `--apply`). `--path` is the checkout to inspect;
 * `--repo` overrides the owner/name the config is stored under. Positional args
 * are crate names; with none, the caller targets every publishable crate in the
 * workspace. Exits, usage error, on an unknown flag or a value-taking flag with
 * no value.
 */
export function parseArgs(argv: readonly string[]): TrustedPublisherArgs {
  let apply = false
  let environment: string | undefined
  let repoPath: string | undefined
  let repo: string | undefined
  let workflow: string | undefined
  const crates: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (VALUE_FLAGS.includes(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) {
        logger.fail(`Flag ${arg} needs a value.`)
        process.exit(1)
      }
      if (arg === '--environment') {
        environment = value
      } else if (arg === '--path') {
        repoPath = value
      } else if (arg === '--repo') {
        repo = value
      } else {
        workflow = value
      }
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      logger.fail(`Unknown flag: ${arg}`)
      process.exit(1)
    }
    crates.push(arg)
  }
  return { apply, crates, environment, path: repoPath, repo, workflow }
}

/**
 * Whether `candidate` names an existing DIRECTORY — the metadata bit is the
 * point, so this stats rather than testing existence. The filesystem half of
 * the `--path` / `--repo` misuse refusals, kept out of the pure matchers so
 * those stay testable without touching disk.
 */
function isExistingDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  // Usage preflight: `--path` and `--repo` are one keystroke apart in intent,
  // and a value handed to the wrong one resolves somewhere unrelated instead of
  // failing. Refuse first, before auth spends a round trip.
  const misuse =
    (args.repo === undefined
      ? undefined
      : repoFlagMisuse(args.repo, {
          isExistingDir: isExistingDirectory(args.repo),
        })) ??
    (args.path === undefined
      ? undefined
      : pathFlagMisuse(args.path, {
          isExistingDir: isExistingDirectory(args.path),
        }))
  if (misuse !== undefined) {
    logger.fail(misuse)
    process.exitCode = 1
    return
  }
  // Auth preflight for BOTH modes: the dry-run reads the registry too, so a
  // malformed saved token would turn into one opaque 403 per crate.
  const token = await resolveCratesToken()
  const problem =
    token === undefined
      ? 'is missing (no env token, no credentials.toml row)'
      : cargoTokenProblem(token)
  if (problem !== undefined || token === undefined) {
    logger.fail(
      `crates.io auth preflight: the token ${problem}. ` +
        'Where: CARGO_REGISTRY_TOKEN, else ~/.cargo/credentials.toml. ' +
        'Fix: mint a token at crates.io/settings/tokens carrying the ' +
        '`trusted-publishing` scope, copy it as the LAST thing on the ' +
        'clipboard (copying a command overwrites it), and pipe: ' +
        'pbpaste | cargo login.',
    )
    process.exitCode = 1
    return
  }

  // The caller's cwd is the anchor ON PURPOSE here: a relative `--path` means
  // what the operator typed it from, and `resolveInspectedRoot` falls back to
  // this script's own root whenever `--path` is absent.
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- operator path base
  const root = resolveInspectedRoot(args.path, process.cwd())
  const slug = args.repo ?? (await resolveRepoSlug(root))
  const surface = args.workflow
    ? { environment: args.environment, workflowFilename: args.workflow }
    : await readCargoPublishSurface(socketReleaseWorkflowsPath(root))
  const target = buildTrustedPublisherTarget(slug, surface, {
    environment: args.environment,
    workflow: args.workflow,
  })

  const crates = args.crates.length
    ? args.crates
    : (await readPublishableCargoPackages(root)).map(p => p.name)
  if (crates.length === 0) {
    logger.fail(
      `[cargo-trustpub] no crates to configure. Where: ${root}. Saw: ` +
        'no publishable package in `cargo metadata`; wanted: at least one. ' +
        'Fix: name the crates explicitly, point --path <dir> at the ' +
        'workspace you meant, or drop `publish = false`.',
    )
    process.exitCode = 1
    return
  }

  logger.log(
    `crates.io trusted publishing — ${crates.length} crate(s)` +
      (args.apply ? ' [apply]' : ' [dry-run]'),
  )
  logger.substep(`path: ${root}`)
  logger.substep(
    `target: ${target.repositoryOwner}/${target.repositoryName} · ` +
      `${target.workflowFilename} · environment ${target.environment ?? '(none)'}`,
  )
  const results = await runTrustedPublisher(crates, target, {
    apply: args.apply,
    token,
  })
  if (results.some(r => r.status === 'failed')) {
    process.exitCode = 1
  }
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the CLI.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
