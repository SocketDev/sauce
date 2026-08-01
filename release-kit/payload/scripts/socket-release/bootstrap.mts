/**
 * @file The socket-release bootstrap: stand up publishing for this repo in
 *   eight idempotent, individually re-runnable steps —
 *   preflight · placeholder · npm-access-permissive · github-env ·
 *   staged-config · trusted-publisher · npm-access-staged-only · verify.
 *   Plan (dry-run) is the DEFAULT for everything destructive; `--apply`
 *   performs effects; `--json` emits exactly ONE machine-readable document
 *   on stdout (human logs go to stderr). Every step begins with live
 *   detection — the state file is a reporting cache, never authority — and
 *   after an apply the runner re-reads and marks `passed` only when the
 *   re-read says done (never false-green).
 *   Exit codes (pinned): 0 passed/planned clean · 1 a step failed ·
 *   2 usage · 3 blocked on a human gate · 4 precondition not done.
 *   Usage: node scripts/socket-release/bootstrap.mts [step ...] [options]
 */

import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib/errors/message'

import { isMainModule } from './_shared/is-main-module.mts'
import { formatHumanGate } from './_shared/human-gate.mts'
import { parseGitHubSlug } from './publish-infra/pin-readme.mts'
import { parseKitConfig } from './bootstrap/config.mts'
import type { KitConfig } from './bootstrap/config.mts'
import {
  STEP_IDS,
  canonicalizeSteps,
  nextCommandFor,
  nextPendingStep,
  planRun,
  preconditionGaps,
} from './bootstrap/plan.mts'
import type {
  StepContext,
  StepDetection,
  StepId,
  StepPlan,
  StepReceipt,
} from './bootstrap/plan.mts'
import {
  KitError,
  gateToJson,
  renderStatusTable,
  renderStepHuman,
} from './bootstrap/render.mts'
import type { RunJson, StepOutcomeJson } from './bootstrap/render.mts'
import {
  STATE_RELATIVE_PATH,
  contextKey,
  loadState,
  resetState,
  saveState,
  withReceipt,
} from './bootstrap/state.mts'
import type { BootstrapState } from './bootstrap/state.mts'
import { REPO_ROOT, resolveSeams } from './bootstrap/seams.mts'
import type { BootstrapSeams } from './bootstrap/seams.mts'
import { npmAuthGate } from './_shared/human-gate.mts'
import * as githubEnv from './bootstrap/steps/github-env.mts'
import * as npmAccessPermissive from './bootstrap/steps/npm-access-permissive.mts'
import * as npmAccessStagedOnly from './bootstrap/steps/npm-access-staged-only.mts'
import * as placeholder from './bootstrap/steps/placeholder.mts'
import * as preflight from './bootstrap/steps/preflight.mts'
import * as stagedConfig from './bootstrap/steps/staged-config.mts'
import * as trustedPublisher from './bootstrap/steps/trusted-publisher.mts'
import * as verify from './bootstrap/steps/verify.mts'

export const KIT_NAME = 'socket-release-kit'
export const KIT_VERSION = '0.1.0'

interface StepShape {
  apply(
    plan: StepPlan,
    ctx: StepContext,
    seams: BootstrapSeams,
  ): Promise<{ effects: RunJson['steps'][number]['effects']; gate?: unknown }>
  classify(inputs: unknown, ctx: StepContext): StepDetection
  id: StepId
  plan(detection: StepDetection, ctx: StepContext): StepPlan
  read(ctx: StepContext, seams: BootstrapSeams): Promise<unknown>
}

const STEP_MODULES: Record<StepId, StepShape> = {
  'github-env': githubEnv as unknown as StepShape,
  'npm-access-permissive': npmAccessPermissive as unknown as StepShape,
  'npm-access-staged-only': npmAccessStagedOnly as unknown as StepShape,
  placeholder: placeholder as unknown as StepShape,
  preflight: preflight as unknown as StepShape,
  'staged-config': stagedConfig as unknown as StepShape,
  'trusted-publisher': trustedPublisher as unknown as StepShape,
  verify: verify as unknown as StepShape,
}

const USAGE = `Usage: node scripts/socket-release/bootstrap.mts [step ...] [options]

Steps (canonical order): ${STEP_IDS.join('  ')}

Options:
  --apply              perform effects (plan/dry-run is the default)
  --dry-run            explicit plan; combined with --apply -> usage error
  --reserve <name>     consent for the placeholder publish (must byte-equal the package name)
  --json               emit exactly one JSON document on stdout (human logs -> stderr)
  --yes                never prompt; where a prompt would be last resort, emit the gate and exit 3
  --status             print the step status table from receipts only; exit 0
  --reset              delete the state file; exit 0
  --access <a>         public | restricted (overrides config)
  --package <name>     subject override
  --repo <owner/name>  GitHub slug override
  --branch <name>      environment deployment branch (default: the default branch)
  --force              consumed only by staged-config (divergent-workflow restore)
  --profile-dir <d>    browser profile override (read lane only)
  --help               this usage
`

export interface RunBootstrapConfig {
  argv: string[]
  log?: ((line: string) => void) | undefined
  out?: ((text: string) => void) | undefined
  repoRoot?: string | undefined
  seams?: BootstrapSeams | undefined
}

/**
 * The whole run, in-process — the CLI calls this with real seams; the
 * integration tests call it with fakes and capture `out`/`log`.
 */
export async function runBootstrap(
  config: RunBootstrapConfig,
): Promise<number> {
  const cfg = { __proto__: null, ...config } as RunBootstrapConfig
  const seams = cfg.seams ?? resolveSeams()
  const repoRoot = cfg.repoRoot ?? REPO_ROOT
  const out = cfg.out ?? ((text: string) => process.stdout.write(text))
  let jsonMode = false
  const log =
    cfg.log ??
    ((line: string) => {
      if (jsonMode) {
        process.stderr.write(`${line}\n`)
      } else {
        process.stdout.write(`${line}\n`)
      }
    })

  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  try {
    const parsed = parseArgs({
      allowPositionals: true,
      args: cfg.argv,
      options: {
        access: { type: 'string' },
        apply: { type: 'boolean' },
        branch: { type: 'string' },
        'dry-run': { type: 'boolean' },
        force: { type: 'boolean' },
        help: { type: 'boolean' },
        json: { type: 'boolean' },
        package: { type: 'string' },
        'profile-dir': { type: 'string' },
        repo: { type: 'string' },
        reserve: { type: 'string' },
        reset: { type: 'boolean' },
        status: { type: 'boolean' },
        yes: { type: 'boolean' },
      },
      strict: true,
    })
    values = parsed.values as Record<string, string | boolean | undefined>
    positionals = [...parsed.positionals]
  } catch (e) {
    log(`bootstrap: ${errorMessage(e)}`)
    log(USAGE)
    return 2
  }
  jsonMode = values['json'] === true

  if (values['help'] === true) {
    log(USAGE)
    return 0
  }
  if (values['apply'] === true && values['dry-run'] === true) {
    log('bootstrap: --apply and --dry-run conflict — pick one.')
    log(USAGE)
    return 2
  }
  if (values['reset'] === true) {
    const removed = resetState(repoRoot)
    log(
      removed
        ? `removed ${STATE_RELATIVE_PATH} — receipts were history only; every step re-detects live state.`
        : `nothing to reset — ${STATE_RELATIVE_PATH} does not exist.`,
    )
    return 0
  }

  let requested: StepId[]
  try {
    requested = canonicalizeSteps(positionals)
  } catch (e) {
    log(`bootstrap: ${errorMessage(e)}`)
    log(USAGE)
    return 2
  }

  const apply = values['apply'] === true
  const mode: RunJson['mode'] =
    values['status'] === true ? 'status' : apply ? 'apply' : 'plan'

  // ---- resolve the run context (reads only; failures surface as checks).
  const configRaw = seams.readFile(
    path.join(repoRoot, '.config/socket-release.json'),
  )
  let kitConfig: KitConfig
  if (configRaw === undefined) {
    log(
      `bootstrap: no .config/socket-release.json in ${repoRoot} — install the kit first ` +
        '(node release-kit/install.mts --target . --channels npm,github-release --apply).',
    )
    return 2
  }
  try {
    kitConfig = parseKitConfig(
      configRaw,
      path.join(repoRoot, '.config/socket-release.json'),
    )
  } catch (e) {
    log(errorMessage(e))
    return e instanceof KitError ? e.exitCode : 2
  }

  const pkgRaw = seams.readFile(path.join(repoRoot, 'package.json'))
  let pkg: {
    name?: string | undefined
    publishConfig?: { access?: string | undefined } | undefined
    version?: string | undefined
  } = {}
  try {
    pkg = pkgRaw ? (JSON.parse(pkgRaw) as typeof pkg) : {}
  } catch {
    pkg = {}
  }
  const packageName =
    (values['package'] as string | undefined) ?? pkg.name ?? '(unresolved)'
  const packageVersion = pkg.version ?? '0.0.0'

  let slug = values['repo'] as string | undefined
  if (!slug) {
    const origin = await seams.exec(
      'git',
      ['remote', 'get-url', 'origin'],
      repoRoot,
    )
    slug = origin.code === 0 ? parseGitHubSlug(origin.stdout.trim()) : undefined
  }
  const resolvedSlug = slug ?? '(unresolved)'

  let defaultBranch = (values['branch'] as string | undefined) ?? 'main'
  let visibility: 'private' | 'public' | 'unknown' = 'unknown'
  if (slug) {
    const repoRead = await seams.exec('gh', ['api', `repos/${slug}`], repoRoot)
    if (repoRead.code === 0) {
      try {
        const repoJson = JSON.parse(repoRead.stdout) as {
          default_branch?: string | undefined
          private?: boolean | undefined
          visibility?: string | undefined
        }
        if (
          typeof repoJson.default_branch === 'string' &&
          values['branch'] === undefined
        ) {
          defaultBranch = repoJson.default_branch
        }
        visibility =
          repoJson.visibility === 'public'
            ? 'public'
            : repoJson.visibility === 'private' || repoJson.private === true
              ? 'private'
              : 'unknown'
      } catch {
        visibility = 'unknown'
      }
    }
  }

  const accessFlag = values['access'] as string | undefined
  if (
    accessFlag !== undefined &&
    accessFlag !== 'public' &&
    accessFlag !== 'restricted'
  ) {
    log(`bootstrap: --access must be public or restricted, saw ${accessFlag}.`)
    return 2
  }
  const access =
    (accessFlag as 'public' | 'restricted' | undefined) ??
    kitConfig.npm.access ??
    (pkg.publishConfig?.access === 'public' ||
    pkg.publishConfig?.access === 'restricted'
      ? pkg.publishConfig.access
      : undefined)

  const ctx: StepContext = {
    access,
    apply,
    branch: values['branch'] as string | undefined,
    channels: kitConfig.channels,
    defaultBranch,
    force: values['force'] === true,
    nodeVersion: process.version,
    packageName,
    packageVersion,
    repoRoot,
    reserve: values['reserve'] as string | undefined,
    slug: resolvedSlug,
    visibility,
    yes: values['yes'] === true,
  }

  const expectedKey = contextKey(resolvedSlug, packageName)
  let state: BootstrapState
  try {
    state = loadState({
      expectedKey,
      packageName,
      packageVersion,
      root: repoRoot,
      slug: resolvedSlug,
    })
  } catch (e) {
    log(errorMessage(e))
    return e instanceof KitError ? e.exitCode : 2
  }

  if (mode === 'status') {
    const table = renderStatusTable(state.receipts)
    for (let i = 0, { length } = table; i < length; i += 1) {
      log(table[i]!)
    }
    if (jsonMode) {
      const doc = buildDoc({
        ctx,
        exitCode: 0,
        mode,
        outcomes: [],
        requested,
        state,
      })
      out(`${JSON.stringify(doc, null, 2)}\n`)
    }
    return 0
  }

  // ---- precondition DAG (exit 4).
  const toRun = planRun(requested, state.receipts)
  const gaps = preconditionGaps(toRun, state.receipts)
  if (gaps.length > 0) {
    const gap = gaps[0]!
    const missingList = gap.missing.join(', ')
    log(
      [
        `Bootstrap precondition not done for step "${gap.step}".`,
        `  Where: the ${gap.step} step's precondition DAG`,
        `  Saw: no passed receipt for: ${missingList}`,
        `  Wanted: ${missingList} passed before ${gap.step}`,
        `  Fix: run \`node scripts/socket-release/bootstrap.mts ${gap.missing.join(' ')} --apply\` first (or run with no steps to resume everything pending).`,
      ].join('\n'),
    )
    if (jsonMode) {
      const doc = buildDoc({
        ctx,
        exitCode: 4,
        mode,
        outcomes: [],
        requested: toRun,
        state,
      })
      out(`${JSON.stringify(doc, null, 2)}\n`)
    }
    return 4
  }

  // ---- run the steps.
  const outcomes: StepOutcomeJson[] = []
  let exitCode = 0
  for (let i = 0, { length } = toRun; i < length; i += 1) {
    const stepId = toRun[i]!
    const mod = STEP_MODULES[stepId]
    const started = seams.now().getTime()
    // eslint-disable-next-line no-await-in-loop -- steps are strictly serial: each later step's detection depends on the earlier applies.
    const outcome = await runStep(mod, ctx, seams, mode)
    outcome.durationMs = Math.max(0, seams.now().getTime() - started)
    outcomes.push(outcome)
    const human = renderStepHuman(outcome)
    for (let l = 0, { length: ll } = human; l < ll; l += 1) {
      log(human[l]!)
    }
    if (mode === 'apply') {
      state = withReceipt(state, stepId, {
        at: seams.now().toISOString(),
        detail: outcome.detail,
        dryRun: false,
        status: outcome.status,
      })
      saveState(repoRoot, state)
    }
    if (outcome.status === 'failed') {
      exitCode = 1
      break
    }
    if (outcome.status === 'blocked') {
      exitCode = 3
      break
    }
    if (outcome.usageExit) {
      exitCode = 2
      break
    }
  }

  const doc = buildDoc({
    ctx,
    exitCode,
    mode,
    outcomes,
    requested: toRun,
    state,
  })
  if (jsonMode) {
    out(`${JSON.stringify(doc, null, 2)}\n`)
  } else if (doc.nextCommand) {
    log(`next: ${doc.nextCommand}`)
  }
  return exitCode
}

interface RunStepOutcome extends StepOutcomeJson {
  usageExit?: boolean | undefined
}

async function runStep(
  mod: StepShape,
  ctx: StepContext,
  seams: BootstrapSeams,
  mode: RunJson['mode'],
): Promise<RunStepOutcome> {
  const base: RunStepOutcome = {
    already: false,
    checks: [],
    detail: '',
    durationMs: 0,
    effects: [],
    gate: null,
    status: 'planned',
    step: mod.id,
  }
  let detection: StepDetection
  try {
    const inputs = await mod.read(ctx, seams)
    detection = mod.classify(inputs, ctx)
  } catch (e) {
    if (e instanceof KitError) {
      throw e
    }
    return {
      ...base,
      detail: `read failed: ${errorMessage(e)}`,
      status: 'failed',
    }
  }
  base.checks = detection.checks
  base.detail = detection.detail
  if (detection.done) {
    return { ...base, already: true, status: 'passed' }
  }
  if (detection.gate) {
    return { ...base, gate: gateToJson(detection.gate), status: 'blocked' }
  }
  if (detection.authUnknown) {
    if (mode === 'apply') {
      return {
        ...base,
        gate: gateToJson(
          npmAuthGate(ctx.repoRoot, `the bootstrap resumes at ${mod.id}.`),
        ),
        status: 'blocked',
      }
    }
    return { ...base, status: 'planned' }
  }
  if (detection.failed) {
    // Fail-closed reads (hardFail) fail in BOTH modes; every other
    // definitive failure renders `planned` in plan mode — a plan reports the
    // machine, it does not grade it (the failing checks stay visible).
    if (mode === 'apply' || detection.hardFail) {
      return { ...base, status: 'failed' }
    }
    return { ...base, status: 'planned' }
  }
  const stepPlan = mod.plan(detection, ctx)
  if (stepPlan.usage) {
    return {
      ...base,
      detail: `--reserve does not name the package: saw ${stepPlan.usage.saw}, wanted ${stepPlan.usage.wanted}.`,
      status: 'failed',
      usageExit: true,
    }
  }
  if (mode !== 'apply') {
    return { ...base, effects: stepPlan.effects, status: 'planned' }
  }
  if (stepPlan.gate) {
    return {
      ...base,
      effects: stepPlan.effects,
      gate: gateToJson(stepPlan.gate),
      status: 'blocked',
    }
  }
  const applied = await mod.apply(stepPlan, ctx, seams)
  if (applied.gate) {
    return {
      ...base,
      effects: applied.effects,
      gate: gateToJson(applied.gate as never),
      status: 'blocked',
    }
  }
  // Post-verify: re-read + re-classify; `passed` ONLY when the re-read says
  // done (never false-green).
  let reDetection: StepDetection
  try {
    const reInputs = await mod.read(ctx, seams)
    reDetection = mod.classify(reInputs, ctx)
  } catch (e) {
    return {
      ...base,
      detail: `post-apply re-read failed: ${errorMessage(e)}`,
      effects: applied.effects,
      status: 'failed',
    }
  }
  base.checks = reDetection.checks
  if (reDetection.done) {
    return {
      ...base,
      detail: reDetection.detail,
      effects: applied.effects,
      status: 'passed',
    }
  }
  if (reDetection.gate) {
    return {
      ...base,
      detail: reDetection.detail,
      effects: applied.effects,
      gate: gateToJson(reDetection.gate),
      status: 'blocked',
    }
  }
  // Read-only steps (preflight/verify) fail here with their own detail;
  // apply steps fail as saved-state-unproven.
  return {
    ...base,
    detail:
      applied.effects.length > 0
        ? `saved-state unproven: the post-apply re-read reports "${reDetection.detail}" — success is the registry's answer, never the command's exit code.`
        : reDetection.detail,
    effects: applied.effects,
    status: 'failed',
  }
}

function buildDoc(config: {
  ctx: StepContext
  exitCode: number
  mode: RunJson['mode']
  outcomes: StepOutcomeJson[]
  requested: StepId[]
  state: BootstrapState
}): RunJson {
  const { ctx, exitCode, mode, outcomes, requested, state } = config
  const receipts: Partial<Record<StepId, StepReceipt>> = state.receipts
  const pending = nextPendingStep(receipts)
  const outcomesClean = outcomes.map(o => {
    const { usageExit: _usageExit, ...rest } = o as StepOutcomeJson & {
      usageExit?: boolean | undefined
    }
    return rest
  })
  return {
    exitCode,
    kit: { name: KIT_NAME, version: KIT_VERSION },
    mode,
    nextCommand: pending
      ? nextCommandFor(pending, { packageName: ctx.packageName })
      : null,
    nextStep: pending ?? null,
    package: {
      access: ctx.access ?? 'unresolved',
      name: ctx.packageName,
      version: ctx.packageVersion,
    },
    repo: {
      defaultBranch: ctx.defaultBranch,
      root: ctx.repoRoot,
      slug: ctx.slug,
      visibility: ctx.visibility,
    },
    requestedSteps: requested,
    schemaVersion: 1,
    state: { path: STATE_RELATIVE_PATH, receipts },
    steps: outcomesClean,
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runBootstrap({ argv: process.argv.slice(2) })
  } catch (e) {
    if (e instanceof KitError) {
      process.stderr.write(`${e.message}\n`)
      process.exitCode = e.exitCode
      return
    }
    process.stderr.write(`bootstrap: ${errorMessage(e)}\n`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  void main()
}

// The gate module import keeps the runner's gate rendering shape-locked to
// the shared factories (mirror-tested); formatHumanGate is re-exported for
// smoke assertions.
export { formatHumanGate }
