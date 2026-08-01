/**
 * @file Step 4 — github-env: stand up the deployment environments the
 *   channel workflows pin (`npm-publish`, `github-release`, `cargo-publish`,
 *   `brew-publish`), each restricted to exactly the target branch via
 *   custom branch policies. API BEFORE BROWSER: the `gh api` lane is
 *   unconditionally first (PUT is idempotent; policies are LISTED before any
 *   POST so duplicates are never created), and the browser fallback is GATE
 *   TEXT ONLY — no tool ever drives github.com. HTTP 403 blocks on
 *   `ghEnvGate`.
 */

import { ghEnvGate } from '../../_shared/human-gate.mts'
import type {
  Check,
  StepApplyResult,
  StepContext,
  StepDetection,
  StepPlan,
} from '../plan.mts'
import type { BootstrapSeams, ExecResult } from '../seams.mts'

export const id = 'github-env' as const

/**
 * The environment each channel's workflow pins.
 */
export const CHANNEL_ENVIRONMENTS: Readonly<Record<string, string>> = {
  brew: 'brew-publish',
  crates: 'cargo-publish',
  'github-release': 'github-release',
  npm: 'npm-publish',
}

/**
 * The environments this run must stand up, in channel order, deduped.
 */
export function desiredEnvironments(channels: readonly string[]): string[] {
  const envs = new Set<string>()
  for (let i = 0, { length } = channels; i < length; i += 1) {
    const env = CHANNEL_ENVIRONMENTS[channels[i]!]
    if (env) {
      envs.add(env)
    }
  }
  return [...envs]
}

export interface GithubEnvInputs {
  envList: ExecResult
  policies: Record<string, ExecResult>
}

export type EnvProbeState =
  | 'forbidden'
  | 'garbled'
  | 'missing'
  | 'restricted-ok'
  | 'unrestricted'
  | 'wrong-branch'

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<GithubEnvInputs> {
  const envList = await seams.exec(
    'gh',
    ['api', `repos/${ctx.slug}/environments`],
    ctx.repoRoot,
  )
  const policies: Record<string, ExecResult> = {}
  const envs = desiredEnvironments(ctx.channels)
  for (let i = 0, { length } = envs; i < length; i += 1) {
    const env = envs[i]!
    // eslint-disable-next-line no-await-in-loop -- serial: a handful of environments, and gh api rate limits favor pacing.
    policies[env] = await seams.exec(
      'gh',
      [
        'api',
        `repos/${ctx.slug}/environments/${env}/deployment-branch-policies`,
      ],
      ctx.repoRoot,
    )
  }
  return { envList, policies }
}

function isForbidden(result: ExecResult): boolean {
  return (
    result.code !== 0 &&
    /HTTP 403|status:? ?403|Forbidden/i.test(result.stderr + result.stdout)
  )
}

/**
 * Classify one environment's probes into the six honest states. Pure —
 * exported for tests. A garbled/unknown response NEVER reads as
 * `restricted-ok`.
 */
export function classifyEnvProbe(config: {
  branch: string
  env: string
  envList: ExecResult
  policy: ExecResult | undefined
}): EnvProbeState {
  const cfg = { __proto__: null, ...config } as typeof config
  if (isForbidden(cfg.envList) || (cfg.policy && isForbidden(cfg.policy))) {
    return 'forbidden'
  }
  if (cfg.envList.code !== 0) {
    return 'garbled'
  }
  let listed: Array<{
    deployment_branch_policy?: {
      custom_branch_policies?: boolean | undefined
      protected_branches?: boolean | undefined
    } | null
    name?: string | undefined
  }>
  try {
    const parsed = JSON.parse(cfg.envList.stdout) as {
      environments?: unknown
    }
    if (!Array.isArray(parsed.environments)) {
      return 'garbled'
    }
    listed = parsed.environments as typeof listed
  } catch {
    return 'garbled'
  }
  const entry = listed.find(e => e.name === cfg.env)
  if (!entry) {
    return 'missing'
  }
  const policy = entry.deployment_branch_policy
  if (!policy || policy.custom_branch_policies !== true) {
    return 'unrestricted'
  }
  if (!cfg.policy || cfg.policy.code !== 0) {
    return 'garbled'
  }
  let branches: string[]
  try {
    const parsed = JSON.parse(cfg.policy.stdout) as {
      branch_policies?: Array<{ name?: string | undefined }> | undefined
    }
    if (!Array.isArray(parsed.branch_policies)) {
      return 'garbled'
    }
    branches = parsed.branch_policies
      .map(p => p.name)
      .filter((n): n is string => typeof n === 'string')
  } catch {
    return 'garbled'
  }
  return branches.length === 1 && branches[0] === cfg.branch
    ? 'restricted-ok'
    : 'wrong-branch'
}

/**
 * Classify every desired environment. Pure — exported for tests.
 */
export function classifyEnvProbes(
  inputs: GithubEnvInputs,
  ctx: StepContext,
): StepDetection {
  const branch = ctx.branch ?? ctx.defaultBranch
  const envs = desiredEnvironments(ctx.channels)
  const checks: Check[] = []
  const states: Record<string, EnvProbeState> = {}
  for (let i = 0, { length } = envs; i < length; i += 1) {
    const env = envs[i]!
    const state = classifyEnvProbe({
      branch,
      env,
      envList: inputs.envList,
      policy: inputs.policies[env],
    })
    states[env] = state
    checks.push({
      fix:
        state === 'restricted-ok'
          ? null
          : state === 'forbidden'
            ? 'grant environment write access (repo admin / token scopes) or follow the gate below.'
            : `run: node scripts/socket-release/bootstrap.mts github-env --apply`,
      id: `env-${env}`,
      ok: state === 'restricted-ok',
      saw: state,
      wanted: `environment ${env} restricted to exactly [${branch}]`,
    })
  }
  const forbidden = envs.find(env => states[env] === 'forbidden')
  if (forbidden) {
    return {
      checks,
      detail: `GitHub refused environment reads/writes on ${ctx.slug} (HTTP 403).`,
      done: false,
      gate: ghEnvGate(
        ctx.slug,
        forbidden,
        'the bootstrap resumes at github-env.',
      ),
      state: 'forbidden',
    }
  }
  const garbled = envs.find(env => states[env] === 'garbled')
  if (garbled) {
    return {
      checks,
      detail: `the environment read for ${garbled} on ${ctx.slug} did not parse — refusing to classify it (never restricted-ok by default).`,
      done: false,
      failed: true,
      state: 'garbled',
    }
  }
  const pending = envs.filter(env => states[env] !== 'restricted-ok')
  return {
    checks,
    detail:
      pending.length === 0
        ? `every desired environment is restricted to [${branch}]`
        : `${pending.length} environment(s) need standing up: ${pending.join(', ')}`,
    done: pending.length === 0,
    state: pending.length === 0 ? 'restricted-ok' : 'pending',
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyEnvProbes(inputs as GithubEnvInputs, ctx)
}

/**
 * The exact `gh api` argv fixes for the pending environments: one idempotent
 * PUT per env, then list-before-POST for the branch policy so duplicates are
 * never created. Pure — exported for tests.
 */
export function planEnvFixes(config: {
  branch: string
  envs: readonly string[]
  slug: string
}): Array<{
  argv: string[]
  env: string
  listBeforePost?: string[] | undefined
}> {
  const cfg = { __proto__: null, ...config } as typeof config
  const fixes: Array<{
    argv: string[]
    env: string
    listBeforePost?: string[] | undefined
  }> = []
  for (let i = 0, { length } = cfg.envs; i < length; i += 1) {
    const env = cfg.envs[i]!
    fixes.push({
      argv: [
        'api',
        '-X',
        'PUT',
        `repos/${cfg.slug}/environments/${env}`,
        '-F',
        'deployment_branch_policy[protected_branches]=false',
        '-F',
        'deployment_branch_policy[custom_branch_policies]=true',
      ],
      env,
    })
    fixes.push({
      argv: [
        'api',
        '-X',
        'POST',
        `repos/${cfg.slug}/environments/${env}/deployment-branch-policies`,
        '-f',
        `name=${cfg.branch}`,
        '-f',
        'type=branch',
      ],
      env,
      listBeforePost: [
        'api',
        `repos/${cfg.slug}/environments/${env}/deployment-branch-policies`,
        '--jq',
        '[.branch_policies[].name]',
      ],
    })
  }
  return fixes
}

export function plan(detection: StepDetection, ctx: StepContext): StepPlan {
  if (detection.done) {
    return { effects: [] }
  }
  const branch = ctx.branch ?? ctx.defaultBranch
  const pending = detection.checks.filter(c => !c.ok).map(c => c.id.slice(4))
  const fixes = planEnvFixes({ branch, envs: pending, slug: ctx.slug })
  return {
    effects: fixes.map(f => ({
      applied: false,
      description: `gh ${f.argv.join(' ')}`,
      kind: 'gh-api' as const,
    })),
  }
}

export async function apply(
  stepPlan: StepPlan,
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<StepApplyResult> {
  const branch = ctx.branch ?? ctx.defaultBranch
  const effects: StepApplyResult['effects'] = []
  for (let i = 0, { length } = stepPlan.effects; i < length; i += 1) {
    const effect = stepPlan.effects[i]!
    const argv = effect.description.replace(/^gh /, '').split(' ')
    if (argv.includes('-X') && argv.includes('POST')) {
      // List-before-POST: never create a duplicate branch policy.
      // eslint-disable-next-line no-await-in-loop -- serial: PUT-then-POST ordering is the API contract.
      const list = await seams.exec(
        'gh',
        ['api', argv[3]!, '--jq', '[.branch_policies[].name]'],
        ctx.repoRoot,
      )
      let existing: string[] = []
      try {
        const parsed: unknown = JSON.parse(list.stdout)
        existing = Array.isArray(parsed)
          ? parsed.filter((n): n is string => typeof n === 'string')
          : []
      } catch {
        existing = []
      }
      if (existing.includes(branch)) {
        effects.push({ ...effect, applied: false })
        continue
      }
    }
    // eslint-disable-next-line no-await-in-loop -- serial: PUT-then-POST ordering is the API contract.
    const result = await seams.exec('gh', argv, ctx.repoRoot)
    if (isForbidden(result)) {
      return {
        effects,
        gate: ghEnvGate(
          ctx.slug,
          argv
            .find(a => a.includes('/environments/'))
            ?.split('/environments/')[1]
            ?.split('/')[0] ?? 'npm-publish',
          'the bootstrap resumes at github-env.',
        ),
      }
    }
    if (result.code !== 0) {
      throw new Error(
        `gh ${argv.join(' ')} exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
      )
    }
    effects.push({ ...effect, applied: true })
  }
  return { effects }
}
