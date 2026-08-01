/**
 * @file Pure planning core for the bootstrap: the canonical step order, the
 *   precondition DAG, run selection (resume), receipt currency, and the
 *   next-command rendering. No I/O anywhere in this module — every function
 *   is unit-testable from inline data, and the runner (`bootstrap.mts`) is
 *   the only caller that feeds it live reads. The canonical order runs
 *   `staged-config` BEFORE `trusted-publisher` (trust config is derived from
 *   the repo's ACTUAL workflows — never configure trust for a workflow that
 *   does not exist), and the two publishing-access steps bracket the
 *   irreversible placeholder publish: PERMISSIVE before it can be needed,
 *   STAGED-ONLY only after trusted publishing is stood up (disabling direct
 *   publishing before OIDC works would brick the package's publish path).
 */

import type { HumanGate } from '../_shared/human-gate.mts'
import type { BootstrapSeams } from './seams.mts'

/**
 * The eight bootstrap steps in canonical execution order.
 */
export const STEP_IDS = [
  'preflight',
  'placeholder',
  'npm-access-permissive',
  'github-env',
  'staged-config',
  'trusted-publisher',
  'npm-access-staged-only',
  'verify',
] as const

export type StepId = (typeof STEP_IDS)[number]

export type StepStatus = 'blocked' | 'failed' | 'passed' | 'planned' | 'skipped'

/**
 * One named detection check inside a step, `--json`-shaped.
 */
export interface Check {
  fix: string | null
  id: string
  ok: boolean
  saw: string
  wanted: string
}

/**
 * One effect a step plans or performs, `--json`-shaped. `applied` is false
 * in plan mode and true only after the effect actually ran.
 */
export interface Effect {
  applied: boolean
  description: string
  kind:
    | 'exec'
    | 'file-write'
    | 'gh-api'
    | 'npm-access'
    | 'npm-trust'
    | 'registry-publish'
}

/**
 * What a step's pure `classify` returns: named state, the checks that
 * support it, and the three routing bits the runner acts on.
 */
export interface StepDetection {
  /**
   * Auth-dependent read died: `planned` + an `auth-unavailable` check in
   * plan mode, `blocked` + npmAuthGate in apply mode (fail closed).
   */
  authUnknown?: boolean | undefined
  checks: Check[]
  detail: string
  /**
   * Live detection says the step's work is already done — `passed` +
   * `already: true`, zero effects.
   */
  done: boolean
  /**
   * Detection-level failure. In APPLY mode → `failed`, exit 1. In PLAN mode
   * the step renders `planned` with its failing checks visible (plan mode
   * reports, it does not classify a machine it cannot fix) — UNLESS
   * `hardFail` is set.
   */
  failed?: boolean | undefined
  /**
   * A failure that holds in BOTH modes: the fail-closed reads (an
   * unreachable registry is never read as unpublished, in plan or apply).
   */
  hardFail?: boolean | undefined
  /**
   * Detection itself blocks on a human (e.g. a staged placeholder pending
   * promotion) — `blocked`, exit 3.
   */
  gate?: HumanGate | undefined
  state: string
}

/**
 * What a step's pure `plan` returns: the effects `apply` would perform, and
 * the gate that blocks apply when consent/auth is missing.
 */
export interface StepPlan {
  effects: Effect[]
  /**
   * Apply cannot proceed without a human decision — `blocked`, exit 3.
   * Ignored in plan mode (a plan performs nothing, so nothing blocks it).
   */
  gate?: HumanGate | undefined
  /**
   * A usage-level refusal (e.g. `--reserve` naming the wrong package) —
   * exit 2 with saw/wanted.
   */
  usage?: { saw: string; wanted: string } | undefined
}

/**
 * One step receipt in the state file — a reporting cache, never authority.
 */
export interface StepReceipt {
  at: string
  detail?: string | undefined
  dryRun: boolean
  status: StepStatus
}

/**
 * Everything a step needs to know about the run — resolved once by the
 * runner, never re-derived inside a step (`process.cwd()` is never called).
 */
export interface StepContext {
  access: 'public' | 'restricted' | undefined
  apply: boolean
  branch: string | undefined
  channels: readonly string[]
  defaultBranch: string
  force: boolean
  nodeVersion: string
  packageName: string
  packageVersion: string
  repoRoot: string
  reserve: string | undefined
  slug: string
  visibility: 'private' | 'public' | 'unknown'
  yes: boolean
}

/**
 * What a step's `apply` reports back — the runner still re-reads and
 * re-classifies before ever marking the step passed (never false-green).
 */
export interface StepApplyResult {
  effects: Effect[]
  /**
   * Apply itself hit a human gate mid-flight (e.g. the web-2FA window).
   */
  gate?: HumanGate | undefined
}

/**
 * The step state machine: `read` gathers live inputs (effects: reads only),
 * `classify` and `plan` are pure, `apply` performs the planned effects. The
 * runner drives read → classify → plan → apply → re-read → re-classify and
 * marks `passed` ONLY when the re-read says done.
 */
export interface StepModule {
  apply(
    plan: StepPlan,
    ctx: StepContext,
    seams: BootstrapSeams,
  ): Promise<StepApplyResult>
  classify(inputs: unknown, ctx: StepContext): StepDetection
  id: StepId
  plan(detection: StepDetection, ctx: StepContext): StepPlan
  read(ctx: StepContext, seams: BootstrapSeams): Promise<unknown>
}

/**
 * The precondition DAG: which steps must have PASSED (receipt or earlier in
 * the same run) before a step may run. `verify` has none by design — it is
 * always runnable read-only.
 */
export const PRECONDITIONS: Readonly<Record<StepId, readonly StepId[]>> = {
  'github-env': ['preflight'],
  'npm-access-permissive': ['preflight', 'placeholder'],
  'npm-access-staged-only': ['placeholder', 'trusted-publisher'],
  placeholder: ['preflight'],
  preflight: [],
  'staged-config': ['preflight'],
  'trusted-publisher': ['placeholder', 'github-env', 'staged-config'],
  verify: [],
}

/**
 * Whether `value` names a real step.
 */
export function isStepId(value: string): value is StepId {
  return (STEP_IDS as readonly string[]).includes(value)
}

/**
 * Positional step args → canonical-order, deduped step list. Unknown names
 * throw a plain Error the CLI maps to a usage refusal (exit 2) listing the
 * valid steps.
 */
export function canonicalizeSteps(positionals: readonly string[]): StepId[] {
  const requested = new Set<string>()
  for (let i = 0, { length } = positionals; i < length; i += 1) {
    const name = positionals[i]!
    if (!isStepId(name)) {
      throw new Error(
        `unknown step "${name}" — valid steps: ${STEP_IDS.join(', ')}`,
      )
    }
    requested.add(name)
  }
  return STEP_IDS.filter(id => requested.has(id))
}

/**
 * Whether a receipt counts toward resume/precondition satisfaction: only a
 * PASSED receipt does — blocked and failed receipts never satisfy a resume,
 * and a plan-mode (dryRun) receipt never exists (plan mode writes nothing).
 */
export function isReceiptCurrent(
  receipt: StepReceipt | undefined,
): receipt is StepReceipt {
  return receipt !== undefined && receipt.status === 'passed'
}

/**
 * The precondition gaps for a requested run: for each requested step, the
 * precondition steps that are neither passed (receipt) nor scheduled earlier
 * in this same run. Non-empty → the runner refuses with exit 4 naming the
 * missing steps and the exact command.
 */
export function preconditionGaps(
  requested: readonly StepId[],
  receipts: Readonly<Partial<Record<StepId, StepReceipt>>>,
): Array<{ missing: StepId[]; step: StepId }> {
  const gaps: Array<{ missing: StepId[]; step: StepId }> = []
  const scheduled = new Set<StepId>()
  for (let i = 0, { length } = requested; i < length; i += 1) {
    const step = requested[i]!
    const missing = PRECONDITIONS[step].filter(
      pre => !scheduled.has(pre) && !isReceiptCurrent(receipts[pre]),
    )
    if (missing.length > 0) {
      gaps.push({ missing: [...missing], step })
    }
    scheduled.add(step)
  }
  return gaps
}

/**
 * The steps a run executes: the requested steps, or — with no positionals —
 * every step whose receipt is not currently passed (resume). An all-passed
 * state resumes to just `verify` so a bare re-run still re-proves the stood
 * up state read-only instead of reporting nothing.
 */
export function planRun(
  requested: readonly StepId[],
  receipts: Readonly<Partial<Record<StepId, StepReceipt>>>,
): StepId[] {
  if (requested.length > 0) {
    return [...requested]
  }
  const pending = STEP_IDS.filter(id => !isReceiptCurrent(receipts[id]))
  return pending.length > 0 ? pending : ['verify']
}

/**
 * The exact command that runs `step` for real — printed as `nextCommand` so
 * the operator (or their AI) never reconstructs flags by hand.
 */
export function nextCommandFor(
  step: StepId,
  config: { packageName: string },
): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const reserve = step === 'placeholder' ? ` --reserve ${cfg.packageName}` : ''
  return `node scripts/socket-release/bootstrap.mts ${step} --apply${reserve}`
}

/**
 * The first canonical step not yet passed after a run, or undefined when
 * everything is stood up.
 */
export function nextPendingStep(
  receipts: Readonly<Partial<Record<StepId, StepReceipt>>>,
): StepId | undefined {
  return STEP_IDS.find(id => !isReceiptCurrent(receipts[id]))
}
