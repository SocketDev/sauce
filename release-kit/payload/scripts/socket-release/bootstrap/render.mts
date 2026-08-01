/**
 * @file Pure rendering for the bootstrap: the four-ingredient error shape
 *   every kit refusal uses (What / Where / Saw vs. wanted / Fix), the
 *   `--json` document assembly, its hand-rolled validator (no schema dep —
 *   tests validate every emitted document AND every committed golden with
 *   the same function so the two can never drift), the human status table,
 *   and the per-step human lines. Nothing here touches process, fs, or the
 *   network.
 */

import { formatHumanGate } from '../_shared/human-gate.mts'
import type { HumanGate } from '../_shared/human-gate.mts'
import { STEP_IDS, isStepId } from './plan.mts'
import type { Check, Effect, StepId, StepReceipt, StepStatus } from './plan.mts'

/**
 * The four ingredients of every kit refusal, as machine fields — tests
 * assert these, never prose sentences.
 */
export interface KitErrorFields {
  fix: string
  saw: string
  wanted?: string | undefined
  what: string
  where: string
}

/**
 * Render the four-ingredient message. Fix is imperative, one concrete
 * action.
 */
export function formatKitError(fields: KitErrorFields): string {
  const f = { __proto__: null, ...fields } as KitErrorFields
  const lines = [f.what, `  Where: ${f.where}`, `  Saw: ${f.saw}`]
  if (f.wanted !== undefined) {
    lines.push(`  Wanted: ${f.wanted}`)
  }
  lines.push(`  Fix: ${f.fix}`)
  return lines.join('\n')
}

/**
 * A kit error: the four ingredients plus the pinned exit code from the §5
 * taxonomy (2 usage · 4 precondition · 1 check-failed/conflict/unproven).
 * Exit 3 is never thrown — a block renders as a human gate, not an error.
 */
export class KitError extends Error {
  exitCode: number
  fields: KitErrorFields
  constructor(
    fields: KitErrorFields,
    exitCode: number,
    options?: ErrorOptions,
  ) {
    super(formatKitError(fields), options)
    this.exitCode = exitCode
    this.fields = { __proto__: null, ...fields } as KitErrorFields
    this.name = 'KitError'
  }
}

/**
 * A gate in `--json` shape: name + the exact rendered lines.
 */
export interface GateJson {
  lines: string[]
  name: string
}

/**
 * Render one gate to its JSON shape (single-gate rendering — queues render
 * through `formatHumanGateQueue` on the human side).
 */
export function gateToJson(gate: HumanGate): GateJson {
  return {
    lines: formatHumanGate(gate, { index: 1, total: 1 }),
    name: gate.name,
  }
}

/**
 * One step's outcome in the emitted document.
 */
export interface StepOutcomeJson {
  already: boolean
  checks: Check[]
  detail: string
  durationMs: number
  effects: Effect[]
  gate: GateJson | null
  status: StepStatus
  step: StepId
}

/**
 * The whole `--json` document — see the pinned schema in the kit README.
 */
export interface RunJson {
  exitCode: number
  kit: { name: string; version: string }
  mode: 'apply' | 'plan' | 'status'
  nextCommand: string | null
  nextStep: StepId | null
  package: { access: string; name: string; version: string }
  repo: {
    defaultBranch: string
    root: string
    slug: string
    visibility: 'private' | 'public' | 'unknown'
  }
  requestedSteps: StepId[]
  schemaVersion: 1
  state: {
    path: string
    receipts: Partial<Record<StepId, StepReceipt>>
  }
  steps: StepOutcomeJson[]
}

const STATUSES: readonly string[] = [
  'blocked',
  'failed',
  'passed',
  'planned',
  'skipped',
]
const EFFECT_KINDS: readonly string[] = [
  'exec',
  'file-write',
  'gh-api',
  'npm-access',
  'npm-trust',
  'registry-publish',
]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Hand-rolled structural validation of an emitted (or golden) run document.
 * Returns the violations found — an empty array means valid. Tests run every
 * emitted document AND every committed golden through this, so schema and
 * fixtures cannot drift apart.
 */
export function validateRunJson(doc: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(doc)) {
    return ['document is not an object']
  }
  if (doc['schemaVersion'] !== 1) {
    errors.push('schemaVersion must be 1')
  }
  const kit = doc['kit']
  if (
    !isRecord(kit) ||
    typeof kit['name'] !== 'string' ||
    typeof kit['version'] !== 'string'
  ) {
    errors.push('kit must be { name, version } strings')
  }
  if (!['apply', 'plan', 'status'].includes(doc['mode'] as string)) {
    errors.push('mode must be plan | apply | status')
  }
  const repo = doc['repo']
  if (
    !isRecord(repo) ||
    typeof repo['root'] !== 'string' ||
    typeof repo['slug'] !== 'string' ||
    typeof repo['defaultBranch'] !== 'string' ||
    !['private', 'public', 'unknown'].includes(repo['visibility'] as string)
  ) {
    errors.push('repo must carry root/slug/defaultBranch/visibility')
  }
  const pkg = doc['package']
  if (
    !isRecord(pkg) ||
    typeof pkg['name'] !== 'string' ||
    typeof pkg['version'] !== 'string' ||
    typeof pkg['access'] !== 'string'
  ) {
    errors.push('package must carry name/version/access strings')
  }
  const requested = doc['requestedSteps']
  if (
    !Array.isArray(requested) ||
    !requested.every(s => typeof s === 'string' && isStepId(s))
  ) {
    errors.push(`requestedSteps must be an array of ${STEP_IDS.join('|')}`)
  }
  const steps = doc['steps']
  if (!Array.isArray(steps)) {
    errors.push('steps must be an array')
  } else {
    for (let i = 0, { length } = steps; i < length; i += 1) {
      const s: unknown = steps[i]
      const at = `steps[${i}]`
      if (!isRecord(s)) {
        errors.push(`${at} is not an object`)
        continue
      }
      if (typeof s['step'] !== 'string' || !isStepId(s['step'])) {
        errors.push(`${at}.step is not a step id`)
      }
      if (!STATUSES.includes(s['status'] as string)) {
        errors.push(`${at}.status must be one of ${STATUSES.join('|')}`)
      }
      if (typeof s['already'] !== 'boolean') {
        errors.push(`${at}.already must be a boolean`)
      }
      if (typeof s['detail'] !== 'string') {
        errors.push(`${at}.detail must be a string`)
      }
      if (!Number.isInteger(s['durationMs'])) {
        errors.push(`${at}.durationMs must be an integer`)
      }
      const checks = s['checks']
      if (!Array.isArray(checks)) {
        errors.push(`${at}.checks must be an array`)
      } else {
        for (let c = 0, cl = checks.length; c < cl; c += 1) {
          const check: unknown = checks[c]
          if (
            !isRecord(check) ||
            typeof check['id'] !== 'string' ||
            typeof check['ok'] !== 'boolean' ||
            typeof check['saw'] !== 'string' ||
            typeof check['wanted'] !== 'string' ||
            (check['fix'] !== null && typeof check['fix'] !== 'string')
          ) {
            errors.push(`${at}.checks[${c}] must be {id, ok, saw, wanted, fix}`)
          }
        }
      }
      const effects = s['effects']
      if (!Array.isArray(effects)) {
        errors.push(`${at}.effects must be an array`)
      } else {
        for (let e = 0, el = effects.length; e < el; e += 1) {
          const effect: unknown = effects[e]
          if (
            !isRecord(effect) ||
            !EFFECT_KINDS.includes(effect['kind'] as string) ||
            typeof effect['description'] !== 'string' ||
            typeof effect['applied'] !== 'boolean'
          ) {
            errors.push(
              `${at}.effects[${e}] must be {kind, description, applied}`,
            )
          }
        }
      }
      const gate = s['gate']
      if (gate !== null) {
        if (
          !isRecord(gate) ||
          typeof gate['name'] !== 'string' ||
          !Array.isArray(gate['lines']) ||
          !(gate['lines'] as unknown[]).every(l => typeof l === 'string')
        ) {
          errors.push(`${at}.gate must be null or {name, lines[]}`)
        }
      }
    }
  }
  const state = doc['state']
  if (
    !isRecord(state) ||
    typeof state['path'] !== 'string' ||
    !isRecord(state['receipts'])
  ) {
    errors.push('state must carry path + receipts')
  }
  const nextStep = doc['nextStep']
  if (
    nextStep !== null &&
    !(typeof nextStep === 'string' && isStepId(nextStep))
  ) {
    errors.push('nextStep must be null or a step id')
  }
  const nextCommand = doc['nextCommand']
  if (nextCommand !== null && typeof nextCommand !== 'string') {
    errors.push('nextCommand must be null or a string')
  }
  const exitCode = doc['exitCode']
  if (
    !Number.isInteger(exitCode) ||
    (exitCode as number) < 0 ||
    (exitCode as number) > 4
  ) {
    errors.push('exitCode must be an integer 0..4')
  }
  return errors
}

/**
 * The `--status` six-line table (eight with the access steps) from receipts
 * only — no live reads.
 */
export function renderStatusTable(
  receipts: Readonly<Partial<Record<StepId, StepReceipt>>>,
): string[] {
  const width = Math.max(...STEP_IDS.map(id => id.length))
  return STEP_IDS.map(id => {
    const r = receipts[id]
    const status = r ? `${r.status}${r.dryRun ? ' (dry-run)' : ''}` : 'pending'
    const at = r ? `  at ${r.at}` : ''
    return `${id.padEnd(width)}  ${status}${at}`
  })
}

/**
 * One step outcome as human lines (stderr in `--json` mode, stdout
 * otherwise).
 */
export function renderStepHuman(outcome: StepOutcomeJson): string[] {
  const mark =
    outcome.status === 'passed'
      ? '✓'
      : outcome.status === 'planned' || outcome.status === 'skipped'
        ? '·'
        : '×'
  const lines = [
    `${mark} ${outcome.step}: ${outcome.status}${outcome.already ? ' (already)' : ''} — ${outcome.detail}`,
  ]
  for (let i = 0, { length } = outcome.checks; i < length; i += 1) {
    const c = outcome.checks[i]!
    if (!c.ok) {
      lines.push(`    × ${c.id}: saw ${c.saw}; wanted ${c.wanted}`)
      if (c.fix) {
        lines.push(`      Fix: ${c.fix}`)
      }
    }
  }
  for (let i = 0, { length } = outcome.effects; i < length; i += 1) {
    const e = outcome.effects[i]!
    lines.push(
      `    ${e.applied ? 'did' : 'would'} [${e.kind}] ${e.description}`,
    )
  }
  if (outcome.gate) {
    lines.push(...outcome.gate.lines)
  }
  return lines
}
