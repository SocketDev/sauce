/**
 * @file Step 7 — npm-access-staged-only: TIGHTEN AFTER. Once the direct
 *   placeholder publish has succeeded and the trusted publisher stands
 *   (both are DAG preconditions — disabling direct publishing before OIDC
 *   works would brick the package's publish path), disable DIRECT
 *   publishing in the npm web UI, leaving ONLY staged/trusted publishing
 *   enabled. From this point the package is staged-only. Idempotent: a
 *   package already staged-only detects as done and no-ops; the browser
 *   opens only under `--apply`.
 */

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { browserSessionGate } from '../../_shared/human-gate.mts'
import { STAGED_ONLY_ACCESS } from '../../publish-infra/npm/access-plan.mts'
import type { PublishingAccessRead } from '../../publish-infra/npm/access-parse.mts'
import { classifyPackument } from './preflight.mts'
import type {
  Check,
  StepApplyResult,
  StepContext,
  StepDetection,
  StepPlan,
} from '../plan.mts'
import type { BootstrapSeams, RegistryJsonResult } from '../seams.mts'

export const id = 'npm-access-staged-only' as const

export interface AccessStagedOnlyInputs {
  access: PublishingAccessRead | undefined
  packument: RegistryJsonResult
}

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<AccessStagedOnlyInputs> {
  const packument = await seams.registryJson(
    `${NPM_REGISTRY_URL}/${encodeURIComponent(ctx.packageName).replace('%40', '@')}`,
  )
  const live = classifyPackument(packument) === 'live'
  // Plan mode opens no browser; the tighten needs the read only under
  // --apply and only once the name is live.
  const access =
    ctx.apply && live
      ? await seams.readPublishingAccess(ctx.packageName)
      : undefined
  return { access, packument }
}

/**
 * Pure classification of the tighten step. Exported for tests.
 */
export function classifyAccessStagedOnly(
  inputs: AccessStagedOnlyInputs,
  ctx: StepContext,
): StepDetection {
  const checks: Check[] = []
  const registryState = classifyPackument(inputs.packument)
  if (registryState === 'unreachable') {
    checks.push({
      fix: 'check the network/proxy and re-run — an unreachable registry read is never classified.',
      id: 'registry-read',
      ok: false,
      saw:
        'unreachable' in inputs.packument
          ? inputs.packument.unreachable
          : `HTTP ${(inputs.packument as { status: number }).status}`,
      wanted: 'a 200 packument',
    })
    return {
      checks,
      detail: `Refusing to read ${ctx.packageName}'s access state: the registry read failed.`,
      done: false,
      failed: true,
      hardFail: true,
      state: 'unreachable',
    }
  }
  if (registryState !== 'live') {
    checks.push({
      fix: `run: node scripts/socket-release/bootstrap.mts placeholder --apply --reserve ${ctx.packageName}`,
      id: 'registry-name-live',
      ok: false,
      saw: registryState,
      wanted: 'the package live on the registry before its access is tightened',
    })
    return {
      checks,
      detail: `${ctx.packageName} is not live yet — the tighten step runs after the placeholder resolves.`,
      done: false,
      failed: true,
      state: 'not-live',
    }
  }
  if (inputs.access === undefined) {
    checks.push({
      fix: null,
      id: 'access-read-deferred',
      ok: true,
      saw: 'browser read deferred (plan mode opens no browser)',
      wanted: 'a publishing-access read under --apply',
    })
    return {
      checks,
      detail: `${ctx.packageName} is live; the staged-only tighten runs under --apply (browser read + uncheck direct publishing).`,
      done: false,
      state: 'unread',
    }
  }
  if (inputs.access.state === 'unknown') {
    checks.push({
      fix: 'sign in to npm in the sanctioned browser session and re-run — an unreadable page is never a state.',
      id: 'access-page-unreadable',
      ok: false,
      saw: 'unknown',
      wanted: 'a readable publishing-access block',
    })
    return {
      checks,
      detail: `${ctx.packageName}'s access page could not be read — refusing to classify.`,
      done: false,
      gate: browserSessionGate(
        `the publishing-access read on ${ctx.packageName} needs the signed-in browser session.`,
        'sign in to npm in the Chrome window the tool opened, then re-run the step.',
        'say "retry the access read" and I re-run `node scripts/socket-release/bootstrap.mts npm-access-staged-only --apply` with the session open.',
        'the bootstrap resumes at npm-access-staged-only.',
      ),
      state: 'unknown',
    }
  }
  if (inputs.access.state === 'staged-only') {
    checks.push({
      fix: null,
      id: 'access-staged-only',
      ok: true,
      saw: 'staged-only (direct publishing disabled)',
      wanted: 'staged publishing only',
    })
    return {
      checks,
      detail: `${ctx.packageName} is staged-only — direct publishing is disabled.`,
      done: true,
      state: 'staged-only',
    }
  }
  checks.push({
    fix: 'run: node scripts/socket-release/bootstrap.mts npm-access-staged-only --apply',
    id: 'access-needs-tightening',
    ok: false,
    saw: inputs.access.state,
    wanted: 'staged-only (direct publishing disabled, staged enabled)',
  })
  return {
    checks,
    detail: `${ctx.packageName} reads ${inputs.access.state}; direct publishing must be disabled now that trusted publishing stands.`,
    done: false,
    state: inputs.access.state,
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyAccessStagedOnly(inputs as AccessStagedOnlyInputs, ctx)
}

export function plan(detection: StepDetection, ctx: StepContext): StepPlan {
  if (detection.done || detection.failed) {
    return { effects: [] }
  }
  return {
    effects: [
      {
        applied: false,
        description: `disable direct publishing on ${ctx.packageName} (uncheck it in the npm web UI via the sanctioned browser session), leaving staged publishing only`,
        kind: 'npm-access',
      },
    ],
  }
}

export async function apply(
  stepPlan: StepPlan,
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<StepApplyResult> {
  if (stepPlan.effects.length === 0) {
    return { effects: [] }
  }
  const write = await seams.writePublishingAccess(
    ctx.packageName,
    STAGED_ONLY_ACCESS,
  )
  return {
    effects: [
      {
        applied: write.ok,
        description: `disable direct publishing on ${ctx.packageName} (uncheck it in the npm web UI via the sanctioned browser session), leaving staged publishing only`,
        kind: 'npm-access',
      },
    ],
  }
}
