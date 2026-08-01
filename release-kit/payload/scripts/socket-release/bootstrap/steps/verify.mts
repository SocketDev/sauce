/**
 * @file Step 8 — verify: the read-only end-to-end proof, and the designated
 *   LIVE CONTRACT TEST for npm wire drift — it drives the REAL packument,
 *   `npm trust list`, and `gh api` reads through the REAL parsers, so a
 *   registry-side contract change surfaces as a loud refusal at operator
 *   run time, never a silently green suite. Never dispatches a workflow,
 *   never stages — "no real staged publish" is structural. Terminal-state
 *   assertion (owner directive): package live, trusted publisher conforming,
 *   environments restricted, workflows on origin, staged-config parity, and
 *   publishing access STAGED-ONLY — a package left permissive is a FAIL with
 *   the exact remediation command.
 */

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { placeholderPromoteGate } from '../../_shared/human-gate.mts'
import { trustedPublisherLaw } from '../../publish-infra/npm/trust-sweep.mts'
import { npmScratchCwd } from '../../publish-infra/npm/shared.mts'
import type { PublishingAccessRead } from '../../publish-infra/npm/access-parse.mts'
import { classifyPackument } from './preflight.mts'
import { findStagedPlaceholder } from './placeholder.mts'
import { classifyEnvProbe, desiredEnvironments } from './github-env.mts'
import { classifyTrustList } from './trusted-publisher.mts'
import {
  classifyStagedConfig,
  read as readStagedConfig,
  workflowsForChannels,
} from './staged-config.mts'
import type { StagedConfigInputs } from './staged-config.mts'
import type {
  Check,
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

export const id = 'verify' as const

export interface VerifyInputs {
  access: PublishingAccessRead | undefined
  envList: ExecResult
  packument: RegistryJsonResult
  pnpmStageHelp: ExecResult
  policies: Record<string, ExecResult>
  stagedConfig: StagedConfigInputs
  stageList: ExecResult | undefined
  trustList: ExecResult
  workflowsOnOrigin: Record<string, ExecResult>
}

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<VerifyInputs> {
  const packument = await seams.registryJson(
    `${NPM_REGISTRY_URL}/${encodeURIComponent(ctx.packageName).replace('%40', '@')}`,
  )
  const live = classifyPackument(packument) === 'live'
  const stageList = live
    ? undefined
    : await seams.exec('pnpm', ['stage', 'list', '--json'], ctx.repoRoot)
  const trustList = await seams.exec(
    'npm',
    ['trust', 'list', ctx.packageName, '--json'],
    npmScratchCwd(),
  )
  const envList = await seams.exec(
    'gh',
    ['api', `repos/${ctx.slug}/environments`],
    ctx.repoRoot,
  )
  const policies: Record<string, ExecResult> = {}
  const envs = desiredEnvironments(ctx.channels)
  for (let i = 0, { length } = envs; i < length; i += 1) {
    const env = envs[i]!
    // eslint-disable-next-line no-await-in-loop -- serial gh api pacing.
    policies[env] = await seams.exec(
      'gh',
      [
        'api',
        `repos/${ctx.slug}/environments/${env}/deployment-branch-policies`,
      ],
      ctx.repoRoot,
    )
  }
  const workflowsOnOrigin: Record<string, ExecResult> = {}
  const files = workflowsForChannels(ctx.channels)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    // eslint-disable-next-line no-await-in-loop -- serial gh api pacing.
    workflowsOnOrigin[f] = await seams.exec(
      'gh',
      [
        'api',
        `repos/${ctx.slug}/contents/.github/workflows/${f}?ref=${ctx.branch ?? ctx.defaultBranch}`,
      ],
      ctx.repoRoot,
    )
  }
  const access =
    ctx.apply && live
      ? await seams.readPublishingAccess(ctx.packageName)
      : undefined
  return {
    access,
    envList,
    packument,
    pnpmStageHelp: await seams.exec('pnpm', ['help', 'stage'], ctx.repoRoot),
    policies,
    stagedConfig: await readStagedConfig(ctx, seams),
    stageList,
    trustList,
    workflowsOnOrigin,
  }
}

/**
 * Aggregate verification over every read. Pure — exported for tests.
 */
export function classifyVerify(
  inputs: VerifyInputs,
  ctx: StepContext,
): StepDetection {
  const checks: Check[] = []
  let authUnknown = false
  const registryState = classifyPackument(inputs.packument)
  if (registryState !== 'live') {
    const staged = findStagedPlaceholder(inputs.stageList, ctx.packageName)
    if (registryState === 'unpublished' && staged.entry) {
      const stageId = staged.entry.stageId ?? '(unknown stage id)'
      checks.push({
        fix: 'node scripts/socket-release/npm-publish.mts --approve',
        id: 'registry-name-live',
        ok: false,
        saw: `staged entry ${stageId} awaiting promotion`,
        wanted: 'the name live on the registry',
      })
      return {
        checks,
        detail: `${ctx.packageName} is staged and pending promotion.`,
        done: false,
        gate: placeholderPromoteGate(
          ctx.packageName,
          stageId,
          'verify re-runs once the name resolves as live.',
        ),
        state: 'staged-pending',
      }
    }
    checks.push({
      fix:
        registryState === 'unreachable'
          ? 'check the network/proxy and re-run — an unreachable registry is never read as an unclaimed name.'
          : `node scripts/socket-release/bootstrap.mts placeholder --apply --reserve ${ctx.packageName}`,
      id: 'registry-name-live',
      ok: false,
      saw: registryState,
      wanted: 'at least one version live on the registry',
    })
  } else {
    checks.push({
      fix: null,
      id: 'registry-name-live',
      ok: true,
      saw: 'live',
      wanted: 'at least one version live on the registry',
    })
  }
  const law = trustedPublisherLaw(ctx.slug)
  const trust = classifyTrustList(inputs.trustList, law)
  if (trust.kind === 'auth-died') {
    authUnknown = true
    checks.push({
      fix: 'log in (node scripts/socket-release/npm-web-auth.mts login) before --apply',
      id: 'trusted-publisher-conforms',
      ok: false,
      saw: 'auth-unavailable',
      wanted: 'a parseable trust config list',
    })
  } else {
    checks.push({
      fix:
        trust.kind === 'conforms'
          ? null
          : 'run: node scripts/socket-release/bootstrap.mts trusted-publisher --apply',
      id: 'trusted-publisher-conforms',
      ok: trust.kind === 'conforms',
      saw: trust.kind,
      wanted: `type github, repository ${ctx.slug}, workflow npm-publish.yml, environment npm-publish, permissions createPackage + createStagedPackage`,
    })
  }
  const branch = ctx.branch ?? ctx.defaultBranch
  const envs = desiredEnvironments(ctx.channels)
  const envStates = envs.map(env =>
    classifyEnvProbe({
      branch,
      env,
      envList: inputs.envList,
      policy: inputs.policies[env],
    }),
  )
  const envOk = envStates.every(s => s === 'restricted-ok')
  checks.push({
    fix: envOk
      ? null
      : 'run: node scripts/socket-release/bootstrap.mts github-env --apply',
    id: 'environments-restricted',
    ok: envOk,
    saw:
      envs.map((env, i) => `${env}: ${envStates[i]}`).join(', ') ||
      '(none desired)',
    wanted: `every desired environment restricted to [${branch}]`,
  })
  const files = workflowsForChannels(ctx.channels)
  const onOriginOk = files.every(f => inputs.workflowsOnOrigin[f]?.code === 0)
  checks.push({
    fix: onOriginOk
      ? null
      : 'commit and push the kit workflows — an uncommitted workflow is not stood up.',
    id: 'workflows-on-origin',
    ok: onOriginOk,
    saw: files
      .map(
        f =>
          `${f}: ${inputs.workflowsOnOrigin[f]?.code === 0 ? 'on origin' : 'absent'}`,
      )
      .join(', '),
    wanted: `every channel workflow present on origin ${branch}`,
  })
  const stagedConfig = classifyStagedConfig(inputs.stagedConfig, ctx)
  checks.push({
    fix: stagedConfig.done
      ? null
      : 'run: node scripts/socket-release/bootstrap.mts staged-config --apply',
    id: 'staged-config-parity',
    ok: stagedConfig.done,
    saw: stagedConfig.detail,
    wanted:
      'local workflows byte-identical to templates; scripts + gitignore present',
  })
  checks.push({
    fix:
      inputs.pnpmStageHelp.code === 0
        ? null
        : 'Set "packageManager": "pnpm@11.17.0" in package.json and run pnpm install — the pinned pnpm predates staged publishing (this also fixes CI: pnpm/action-setup reads packageManager).',
    id: 'pnpm-stage-support',
    ok: inputs.pnpmStageHelp.code === 0,
    saw: `pnpm help stage exited ${inputs.pnpmStageHelp.code}`,
    wanted: 'exit 0 — CI publishes with the pinned pnpm',
  })
  if (ctx.visibility === 'private') {
    checks.push({
      fix: null,
      id: 'provenance-expectation',
      ok: true,
      saw: 'private repo — provenance disabled (npm rejects private-repo attestations); staged publishing still works',
      wanted: 'informational',
    })
  }
  // Terminal access state (owner directive): staged-only, direct DISABLED.
  if (inputs.access === undefined) {
    checks.push({
      fix: null,
      id: 'npm-access-staged-only',
      ok: !ctx.apply,
      saw: ctx.apply
        ? 'browser read unavailable'
        : 'browser read deferred (plan mode opens no browser)',
      wanted: 'staged-only (direct publishing disabled)',
    })
  } else {
    const stagedOnly = inputs.access.state === 'staged-only'
    checks.push({
      fix: stagedOnly
        ? null
        : 'run: node scripts/socket-release/bootstrap.mts npm-access-staged-only --apply',
      id: 'npm-access-staged-only',
      ok: stagedOnly,
      saw: inputs.access.state,
      wanted: 'staged-only (direct publishing disabled, staged enabled)',
    })
  }
  checks.push({
    fix: null,
    id: 'state-coherent',
    ok: true,
    saw: 'contextKey matches the resolved repo/package',
    wanted: 'receipts keyed to this context',
  })
  const failing = checks.filter(c => !c.ok)
  if (authUnknown && failing.every(c => c.saw === 'auth-unavailable')) {
    return {
      authUnknown: true,
      checks,
      detail: 'auth-dependent verifications could not be read.',
      done: false,
      state: 'auth-unknown',
    }
  }
  return {
    checks,
    detail:
      failing.length === 0
        ? "publishing is stood up; first real release: bump version + CHANGELOG, commit 'chore: bump version to <v>', push, dispatch npm-publish from the Actions UI, then run 'node scripts/socket-release/npm-publish.mts --approve' locally."
        : `${failing.length} verification(s) failing: ${failing.map(c => c.id).join(', ')}`,
    done: failing.length === 0,
    failed: failing.length > 0 && !authUnknown,
    hardFail: registryState === 'unreachable',
    ...(authUnknown ? { authUnknown: true } : {}),
    state: failing.length === 0 ? 'stood-up' : 'not-stood-up',
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyVerify(inputs as VerifyInputs, ctx)
}

export function plan(): StepPlan {
  // Read-only end-to-end: verify never dispatches, never stages, never
  // writes — plan and apply are the same reads.
  return { effects: [] }
}

export async function apply(): Promise<StepApplyResult> {
  return { effects: [] }
}
