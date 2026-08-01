/**
 * @file Step 3 — npm-access-permissive: ensure the package's
 *   publishing-access settings permit BOTH direct and staged publishing —
 *   but ONLY while the one-time placeholder publish is still pending. Once
 *   the name is live the placeholder succeeded and this step is
 *   already-done by definition: a re-run NEVER re-widens permissions (the
 *   live-name short-circuit fires before any browser read). The browser
 *   read/write lane runs only under `--apply` (plan mode opens no browser),
 *   and an unreadable page refuses rather than classifying.
 */

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { browserSessionGate } from '../../_shared/human-gate.mts'
import { PERMISSIVE_ACCESS } from '../../publish-infra/npm/access-plan.mts'
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

export const id = 'npm-access-permissive' as const

export interface AccessPermissiveInputs {
  /**
   * Undefined when the browser read was deliberately skipped (plan mode, or
   * the live-name short-circuit).
   */
  access: PublishingAccessRead | undefined
  packument: RegistryJsonResult
}

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<AccessPermissiveInputs> {
  const packument = await seams.registryJson(
    `${NPM_REGISTRY_URL}/${encodeURIComponent(ctx.packageName).replace('%40', '@')}`,
  )
  const live = classifyPackument(packument) === 'live'
  // The browser opens ONLY under --apply and ONLY while the placeholder is
  // pending — a live name never re-widens, and a plan run stays browserless.
  const access =
    ctx.apply && !live
      ? await seams.readPublishingAccess(ctx.packageName)
      : undefined
  return { access, packument }
}

/**
 * Pure classification of the permissive step. Exported for tests.
 */
export function classifyAccessPermissive(
  inputs: AccessPermissiveInputs,
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
      detail: `Refusing to read ${ctx.packageName}'s access state: the registry read failed.`,
      done: false,
      failed: true,
      hardFail: true,
      state: 'unreachable',
    }
  }
  if (registryState === 'live') {
    checks.push({
      fix: null,
      id: 'never-re-widen',
      ok: true,
      saw: 'name live — the placeholder publish already succeeded',
      wanted: 'permissive access only while the placeholder is pending',
    })
    return {
      checks,
      detail: `${ctx.packageName} is live; publishing access is left untouched (a re-run never re-widens permissions).`,
      done: true,
      state: 'live',
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
      detail: `${ctx.packageName} is not yet live; the permissive ensure runs under --apply (npm defaults a brand-new package to permissive).`,
      done: false,
      state: 'pending-unread',
    }
  }
  if (inputs.access.state === 'unknown') {
    checks.push({
      fix: null,
      id: 'access-page-unreadable',
      ok: true,
      saw: 'no readable publishing-access block (package likely not created yet)',
      wanted: 'the signed-in access page, once the package exists',
    })
    return {
      checks,
      detail: `${ctx.packageName} has no readable access page yet — npm defaults a brand-new package to permissive, and the placeholder apply re-ensures it right after the publish.`,
      done: true,
      state: 'not-created',
    }
  }
  if (inputs.access.state === 'both-enabled') {
    checks.push({
      fix: null,
      id: 'access-permissive',
      ok: true,
      saw: 'both-enabled',
      wanted:
        'direct + staged publishing enabled while the placeholder is pending',
    })
    return {
      checks,
      detail: `${ctx.packageName} already permits both direct and staged publishing.`,
      done: true,
      state: 'both-enabled',
    }
  }
  checks.push({
    fix: null,
    id: 'access-needs-widening',
    ok: false,
    saw: inputs.access.state,
    wanted: 'both-enabled while the placeholder publish is pending',
  })
  return {
    checks,
    detail: `${ctx.packageName} reads ${inputs.access.state}; the pending placeholder needs both direct and staged publishing enabled.`,
    done: false,
    state: inputs.access.state,
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyAccessPermissive(inputs as AccessPermissiveInputs, ctx)
}

export function plan(detection: StepDetection, ctx: StepContext): StepPlan {
  if (detection.done) {
    return { effects: [] }
  }
  return {
    effects: [
      {
        applied: false,
        description: `enable direct + staged publishing (permissive) on ${ctx.packageName} via the sanctioned browser session`,
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
    PERMISSIVE_ACCESS,
  )
  if (!write.ok) {
    return {
      effects: [
        {
          applied: false,
          description: `enable direct + staged publishing (permissive) on ${ctx.packageName} via the sanctioned browser session`,
          kind: 'npm-access',
        },
      ],
      gate: browserSessionGate(
        `the publishing-access save on ${ctx.packageName} did not verify — the page may need your sign-in or 2FA.`,
        'sign in to npm in the Chrome window the tool opened, then re-run the step.',
        'say "retry the access write" and I re-run `node scripts/socket-release/bootstrap.mts npm-access-permissive --apply` with the session open.',
        'the bootstrap resumes at npm-access-permissive.',
      ),
    }
  }
  return {
    effects: [
      {
        applied: true,
        description: `enable direct + staged publishing (permissive) on ${ctx.packageName} via the sanctioned browser session`,
        kind: 'npm-access',
      },
    ],
  }
}
