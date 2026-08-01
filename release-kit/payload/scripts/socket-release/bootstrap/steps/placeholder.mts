/**
 * @file Step 2 — placeholder: the sanctioned ONE-TIME publish of
 *   `<name>@0.0.0` that claims the package name. This is the bootstrap's
 *   single irreversible act (the version is burned forever; unpublish closes
 *   after 72h), so the consent policy is hard opt-in: `--apply` alone never
 *   publishes — it blocks on `reserveNameGate` until the invocation carries
 *   `--reserve <exact-package-name>` (a mismatch is a usage refusal naming
 *   saw/wanted). Detection short-circuits on a live name, making a
 *   double-publish structurally unreachable, and an unreachable registry is
 *   NEVER read as unclaimed. Post-publish, the publishing-access settings
 *   are ensured PERMISSIVE (direct + staged both enabled) while the
 *   placeholder is still pending — the one window that shape is ever
 *   applied; the `npm-access-staged-only` step tightens it after trusted
 *   publishing stands.
 */

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import {
  npmAuthGate,
  placeholderPromoteGate,
  reserveNameGate,
} from '../../_shared/human-gate.mts'
import { PLACEHOLDER_VERSION } from '../../publish-infra/npm/placeholder.mts'
import { parseStageListJson } from '../../publish-infra/npm/shared.mts'
import type { StageListEntry } from '../../publish-infra/npm/shared.mts'
import { PERMISSIVE_ACCESS } from '../../publish-infra/npm/access-plan.mts'
import { classifyPackument } from './preflight.mts'
import type {
  Check,
  Effect,
  StepApplyResult,
  StepContext,
  StepDetection,
  StepPlan,
} from '../plan.mts'
import type {
  BootstrapSeams,
  ExecResult,
  RegistryJsonResult,
} from '../seams.mts'

export const id = 'placeholder' as const

export interface PlaceholderInputs {
  packument: RegistryJsonResult
  stageList: ExecResult | undefined
}

export type PlaceholderState =
  | 'auth-unknown'
  | 'live'
  | 'staged-pending'
  | 'unclaimed'
  | 'unreachable'

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<PlaceholderInputs> {
  const packument = await seams.registryJson(
    `${NPM_REGISTRY_URL}/${encodeURIComponent(ctx.packageName).replace('%40', '@')}`,
  )
  const state = classifyPackument(packument)
  const stageList =
    state === 'live'
      ? undefined
      : await seams.exec('pnpm', ['stage', 'list', '--json'], ctx.repoRoot)
  return { packument, stageList }
}

/**
 * Find this package's staged 0.0.0 entry in a stage list, tolerating an
 * auth-dead or garbled list by classifying it honestly. Pure.
 */
export function findStagedPlaceholder(
  stageList: ExecResult | undefined,
  packageName?: string | undefined,
): { entry?: StageListEntry | undefined; state: 'auth-unknown' | 'read' } {
  if (stageList === undefined) {
    return { state: 'read' }
  }
  if (stageList.code !== 0) {
    return { state: 'auth-unknown' }
  }
  try {
    const entries = parseStageListJson(stageList.stdout)
    const entry =
      packageName === undefined
        ? entries[0]
        : entries.find(e => e.name === packageName)
    return { entry, state: 'read' }
  } catch {
    // StageListAuthError and any unparseable list: an unauthenticated stage
    // list reads as EMPTY, never as an error — so a parse failure must be
    // classified as auth-unknown, never as "nothing staged".
    return { state: 'auth-unknown' }
  }
}

/**
 * The placeholder detection state machine. Pure — exported for tests.
 */
export function classifyPlaceholderState(
  inputs: PlaceholderInputs,
  ctx: StepContext,
): StepDetection {
  const checks: Check[] = []
  const registryState = classifyPackument(inputs.packument)
  if (registryState === 'unreachable') {
    checks.push({
      fix: 'check the network/proxy and re-run — an unreachable registry is never read as an unclaimed name.',
      id: 'registry-read',
      ok: false,
      saw:
        'unreachable' in inputs.packument
          ? inputs.packument.unreachable
          : `HTTP ${(inputs.packument as { status: number }).status}`,
      wanted: 'a 200 packument or a definitive 404',
    })
    return {
      checks,
      detail: `Refusing to classify ${ctx.packageName} as unpublished: the registry read failed.`,
      done: false,
      failed: true,
      hardFail: true,
      state: 'unreachable',
    }
  }
  if (registryState === 'live') {
    checks.push({
      fix: null,
      id: 'registry-name-live',
      ok: true,
      saw: 'at least one version live on the registry',
      wanted: 'the name resolves',
    })
    return {
      checks,
      detail: `${ctx.packageName} is live on the registry — the name is claimed; nothing to publish.`,
      done: true,
      state: 'live',
    }
  }
  const staged = findStagedPlaceholder(inputs.stageList, ctx.packageName)
  if (staged.state === 'auth-unknown') {
    checks.push({
      fix: 'log in (node scripts/socket-release/npm-web-auth.mts login) before --apply',
      id: 'stage-list-unknown',
      ok: false,
      saw: 'auth-unavailable',
      wanted: 'a readable stage list',
    })
    return {
      authUnknown: true,
      checks,
      detail: `${ctx.packageName} is not live and the stage list could not be read (auth unavailable).`,
      done: false,
      state: 'auth-unknown',
    }
  }
  if (staged.entry) {
    const stageId = staged.entry.stageId ?? '(unknown stage id)'
    checks.push({
      fix: null,
      id: 'staged-placeholder-pending',
      ok: false,
      saw: `staged entry ${stageId} awaiting promotion`,
      wanted: 'the name live on the registry',
    })
    return {
      checks,
      detail: `${ctx.packageName}@${PLACEHOLDER_VERSION} is staged (${stageId}) and waiting on promotion.`,
      done: false,
      gate: placeholderPromoteGate(
        ctx.packageName,
        stageId,
        'the bootstrap resumes at placeholder once the name resolves as live.',
      ),
      state: 'staged-pending',
    }
  }
  if (ctx.packageName.startsWith('@') && ctx.access === undefined) {
    // §6 byte contract: no accidental `public` — a scoped package refuses
    // before planning without an explicit access level.
    checks.push({
      fix: 'set "npm": { "access": "restricted" } in .config/socket-release.json, or pass --access restricted.',
      id: 'access-resolved',
      ok: false,
      saw: 'none of them is set',
      wanted: 'public or restricted',
    })
    return {
      checks,
      detail: `Placeholder needs an explicit access level for the scoped package ${ctx.packageName}.`,
      done: false,
      failed: true,
      state: 'access-unresolved',
    }
  }
  checks.push({
    fix: null,
    id: 'registry-name-unclaimed',
    ok: true,
    saw: 'definitive 404 — the name is unclaimed',
    wanted: 'a definitive registry answer',
  })
  return {
    checks,
    detail: `${ctx.packageName} is unclaimed on npm — reserving it publishes a real ${PLACEHOLDER_VERSION} placeholder.`,
    done: false,
    state: 'unclaimed',
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyPlaceholderState(inputs as PlaceholderInputs, ctx)
}

export function plan(detection: StepDetection, ctx: StepContext): StepPlan {
  if (detection.done || detection.state !== 'unclaimed') {
    return { effects: [] }
  }
  const access = ctx.access ?? 'public'
  // Consent policy: --reserve must byte-equal the resolved package name.
  if (ctx.reserve !== undefined && ctx.reserve !== ctx.packageName) {
    return {
      effects: [],
      usage: { saw: ctx.reserve, wanted: ctx.packageName },
    }
  }
  const effects = [
    {
      applied: false,
      description: `publish ${ctx.packageName}@${PLACEHOLDER_VERSION} --access ${access} via npm-web-auth PTY (placeholder package: package.json + one-line README, files: [])`,
      kind: 'registry-publish' as const,
    },
    {
      applied: false,
      description: `ensure publishing access PERMISSIVE (direct + staged) on ${ctx.packageName} while the placeholder is pending`,
      kind: 'npm-access' as const,
    },
  ]
  if (ctx.apply && ctx.reserve === undefined) {
    // Yes-mode does NOT substitute for --reserve: publishing 0.0.0 is the
    // irreversible act, so the gate renders even under --yes.
    return {
      effects,
      gate: reserveNameGate(
        ctx.packageName,
        access,
        'the bootstrap resumes at placeholder and continues to the remaining steps.',
      ),
    }
  }
  return { effects }
}

export async function apply(
  stepPlan: StepPlan,
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<StepApplyResult> {
  if (stepPlan.effects.length === 0) {
    return { effects: [] }
  }
  const access = ctx.access ?? 'public'
  const identified = await seams.ensureNpmIdentity(ctx.packageName)
  if (!identified) {
    return {
      effects: [],
      gate: npmAuthGate(ctx.repoRoot, 'the bootstrap resumes at placeholder.'),
    }
  }
  const results = await seams.runPlaceholder({
    access,
    apply: true,
    names: [ctx.packageName],
  })
  const publishEffect: Effect = {
    applied: true,
    description: `publish ${ctx.packageName}@${PLACEHOLDER_VERSION} --access ${access} via npm-web-auth PTY (placeholder package: package.json + one-line README, files: [])`,
    kind: 'registry-publish',
  }
  const outcome = results[0]
  if (!outcome || outcome.status === 'failed' || outcome.status === 'skipped') {
    throw new Error(
      `placeholder publish for ${ctx.packageName} did not complete: ${outcome?.detail ?? 'no result'}`,
    )
  }
  // AMENDMENT: permissive-first — the settings exist only once the publish
  // created the package, so ensure BOTH direct and staged publishing are
  // enabled immediately after, while the placeholder is still pending. A
  // name that re-reads as live needs nothing (and is never re-widened).
  const effects: Effect[] = [publishEffect]
  const reread = await seams.registryJson(
    `${NPM_REGISTRY_URL}/${encodeURIComponent(ctx.packageName).replace('%40', '@')}`,
  )
  if (classifyPackument(reread) !== 'live') {
    const accessRead = await seams.readPublishingAccess(ctx.packageName)
    if (accessRead.state !== 'unknown' && accessRead.state !== 'both-enabled') {
      const write = await seams.writePublishingAccess(
        ctx.packageName,
        PERMISSIVE_ACCESS,
      )
      effects.push({
        applied: write.ok,
        description: `ensure publishing access PERMISSIVE (direct + staged) on ${ctx.packageName} while the placeholder is pending`,
        kind: 'npm-access',
      })
    }
  }
  return { effects }
}
