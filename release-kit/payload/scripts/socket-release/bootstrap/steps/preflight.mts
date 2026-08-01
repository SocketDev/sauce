/**
 * @file Step 1 — preflight: the ten read-only checks that decide whether
 *   this repo can be stood up at all. `plan` and `apply` are identical (a
 *   read-only step performs the same reads either way); classification is
 *   pure over the gathered inputs so every check arm is unit-testable from
 *   inline data. Fail-closed rule: an unreachable registry FAILS the
 *   `registry-reachable` check — it is never read as "unpublished".
 */

import path from 'node:path'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { parseGitHubSlug } from '../../publish-infra/pin-readme.mts'
import { npmScratchCwd } from '../../publish-infra/npm/shared.mts'
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

/**
 * Node floor for the kit CLIs: native `.mts` execution (no tsx, no
 * strip-types flag).
 */
export const NODE_FLOOR = { major: 22, minor: 18 }

export const KIT_DEP_PINS: ReadonlyArray<{ pin: string; specifier: string }> = [
  { pin: '6.5.2', specifier: '@socketsecurity/lib' },
  { pin: '4.1.3', specifier: '@socketsecurity/sdk' },
  { pin: '1.61.1', specifier: 'playwright-core' },
]

export interface PreflightInputs {
  deps: { lib: boolean; playwright: boolean; sdk: boolean }
  ghAuth: ExecResult
  ghRepo: ExecResult
  gitOrigin: ExecResult
  npmTrustHelp: ExecResult
  packageJsonRaw: string | undefined
  packument: RegistryJsonResult
  pnpmStageHelp: ExecResult
}

/**
 * Gather the ten checks' inputs — reads only.
 */
export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<PreflightInputs> {
  const [gitOrigin, ghRepo, ghAuth, pnpmStageHelp, npmTrustHelp, packument] =
    await Promise.all([
      seams.exec('git', ['remote', 'get-url', 'origin'], ctx.repoRoot),
      seams.exec('gh', ['api', `repos/${ctx.slug}`], ctx.repoRoot),
      seams.exec('gh', ['auth', 'status'], ctx.repoRoot),
      seams.exec('pnpm', ['help', 'stage'], ctx.repoRoot),
      seams.exec('npm', ['trust', '--help'], npmScratchCwd()),
      seams.registryJson(
        `${NPM_REGISTRY_URL}/${encodeURIComponent(ctx.packageName).replace('%40', '@')}`,
      ),
    ])
  return {
    deps: {
      lib: seams.resolveKitDep(
        '@socketsecurity/lib/errors/message',
        ctx.repoRoot,
      ),
      playwright: seams.resolveKitDep('playwright-core', ctx.repoRoot),
      sdk: seams.resolveKitDep('@socketsecurity/sdk', ctx.repoRoot),
    },
    ghAuth,
    ghRepo,
    gitOrigin,
    npmTrustHelp,
    packageJsonRaw: seams.readFile(path.join(ctx.repoRoot, 'package.json')),
    packument,
    pnpmStageHelp,
  }
}

/**
 * Classify the running node version against the floor. Pure — exported for
 * tests.
 */
export function nodeVersionOk(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version)
  if (!m) {
    return false
  }
  const major = Number(m[1])
  const minor = Number(m[2])
  return (
    major > NODE_FLOOR.major ||
    (major === NODE_FLOOR.major && minor >= NODE_FLOOR.minor)
  )
}

/**
 * Classify a packument read into the three honest states. Pure — exported
 * for tests and reused by placeholder/verify.
 */
export function classifyPackument(
  packument: RegistryJsonResult,
): 'live' | 'unpublished' | 'unreachable' {
  if ('unreachable' in packument) {
    return 'unreachable'
  }
  if (packument.status === 404) {
    return 'unpublished'
  }
  if (packument.status >= 200 && packument.status < 300) {
    const body = packument.body as
      | { versions?: Record<string, unknown> | undefined }
      | undefined
    return body && Object.keys(body.versions ?? {}).length > 0
      ? 'live'
      : 'unpublished'
  }
  return 'unreachable'
}

/**
 * The ten preflight checks over the gathered inputs. Pure.
 */
export function classifyPreflightInputs(
  inputs: PreflightInputs,
  ctx: StepContext,
): StepDetection {
  const checks: Check[] = []
  const push = (
    id: string,
    ok: boolean,
    saw: string,
    wanted: string,
    fix: string | null,
  ) => {
    checks.push({ fix: ok ? null : fix, id, ok, saw, wanted })
  }
  push(
    'node-version',
    nodeVersionOk(ctx.nodeVersion),
    ctx.nodeVersion,
    `node >= ${NODE_FLOOR.major}.${NODE_FLOOR.minor} (native .mts execution)`,
    'run the kit CLIs with node >= 22.18 (nvm install 24).',
  )
  const originUrl = inputs.gitOrigin.stdout.trim()
  const slug =
    inputs.gitOrigin.code === 0 ? parseGitHubSlug(originUrl) : undefined
  push(
    'git-origin-github',
    inputs.gitOrigin.code === 0 && slug !== undefined,
    originUrl || `git remote get-url origin exited ${inputs.gitOrigin.code}`,
    'https://github.com/<owner>/<repo>(.git) or git@github.com:<owner>/<repo>(.git)',
    'git remote set-url origin https://github.com/<owner>/<repo>.git',
  )
  let defaultBranchSaw = `gh api repos/${ctx.slug} exited ${inputs.ghRepo.code}`
  let defaultBranchOk = false
  if (inputs.ghRepo.code === 0) {
    try {
      const repo = JSON.parse(inputs.ghRepo.stdout) as {
        default_branch?: string | undefined
        visibility?: string | undefined
      }
      defaultBranchOk = typeof repo.default_branch === 'string'
      defaultBranchSaw = `default branch ${repo.default_branch ?? '(none)'}, visibility ${repo.visibility ?? 'unknown'}`
    } catch {
      defaultBranchSaw = 'unparseable gh api response'
    }
  }
  push(
    'default-branch',
    defaultBranchOk,
    defaultBranchSaw,
    'a readable repo with a default branch',
    'run `gh auth login` (or fix the slug with --repo <owner/name>) and re-run.',
  )
  if (ctx.visibility === 'private') {
    push(
      'provenance-expectation',
      true,
      'private repo — provenance disabled (npm rejects private-repo attestations); staged publishing still works',
      'informational',
      null,
    )
  }
  let manifestOk = false
  let manifestSaw = 'package.json missing'
  if (inputs.packageJsonRaw !== undefined) {
    try {
      const pkg = JSON.parse(inputs.packageJsonRaw) as {
        files?: unknown
        name?: unknown
        packageManager?: unknown
        version?: unknown
      }
      const filesOk = Array.isArray(pkg.files) && pkg.files.length > 0
      const pmOk =
        typeof pkg.packageManager === 'string' &&
        /^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)
      manifestOk =
        typeof pkg.name === 'string' &&
        typeof pkg.version === 'string' &&
        filesOk &&
        pmOk
      manifestSaw = `name ${String(pkg.name)}, version ${String(pkg.version)}, files ${
        filesOk ? 'present' : 'missing/empty'
      }, packageManager ${String(pkg.packageManager)}`
    } catch {
      manifestSaw = 'unparseable package.json'
    }
  }
  push(
    'package-manifest',
    manifestOk,
    manifestSaw,
    'name + version + non-empty files + packageManager matching ^pnpm@X.Y.Z$',
    'fill in package.json: name, version, a files allow-list, and a pinned packageManager.',
  )
  push(
    'pnpm-stage-support',
    inputs.pnpmStageHelp.code === 0,
    `pnpm help stage exited ${inputs.pnpmStageHelp.code}`,
    'exit 0 (staged publishing supported)',
    'Set "packageManager": "pnpm@11.17.0" in package.json and run pnpm install — the pinned pnpm predates staged publishing (this also fixes CI: pnpm/action-setup reads packageManager).',
  )
  push(
    'npm-trust-support',
    inputs.npmTrustHelp.code === 0,
    `npm trust --help exited ${inputs.npmTrustHelp.code}`,
    'exit 0 (npm trust available)',
    "upgrade npm to >= 12 (node 24 ships it): the trusted-publisher step drives 'npm trust'.",
  )
  push(
    'gh-auth',
    inputs.ghAuth.code === 0,
    `gh auth status exited ${inputs.ghAuth.code}`,
    'exit 0 (gh authenticated)',
    'run `gh auth login`.',
  )
  const missingDeps = KIT_DEP_PINS.filter(d =>
    d.specifier === '@socketsecurity/lib'
      ? !inputs.deps.lib
      : d.specifier === '@socketsecurity/sdk'
        ? !inputs.deps.sdk
        : !inputs.deps.playwright,
  )
  push(
    'kit-deps-resolvable',
    missingDeps.length === 0,
    missingDeps.length === 0
      ? 'all three kit dependencies resolve'
      : `unresolvable: ${missingDeps.map(d => d.specifier).join(', ')}`,
    '@socketsecurity/lib + @socketsecurity/sdk + playwright-core resolvable from the repo root',
    `pnpm add -D ${KIT_DEP_PINS.map(d => `${d.specifier}@${d.pin}`).join(' ')}`,
  )
  const registryState = classifyPackument(inputs.packument)
  push(
    'registry-reachable',
    registryState !== 'unreachable',
    registryState === 'unreachable'
      ? `unreachable: ${'unreachable' in inputs.packument ? inputs.packument.unreachable : `HTTP ${(inputs.packument as { status: number }).status}`}`
      : registryState,
    'a 200 packument or a definitive 404',
    'check the network/proxy and re-run — an unreachable registry is never read as an unclaimed name.',
  )
  const scoped = ctx.packageName.startsWith('@')
  push(
    'access-resolved',
    !scoped || ctx.access !== undefined,
    ctx.access ??
      'none of config npm.access, publishConfig.access, --access is set',
    'public or restricted',
    'set "npm": { "access": "restricted" } in .config/socket-release.json, or pass --access restricted.',
  )
  const failing = checks.filter(c => !c.ok)
  return {
    checks,
    detail:
      failing.length === 0
        ? 'all preflight checks pass'
        : `${failing.length} preflight check(s) failing: ${failing.map(c => c.id).join(', ')}`,
    done: failing.length === 0,
    failed: failing.length > 0,
    // Fail-closed in BOTH modes only for the unreachable registry; every
    // other preflight gap renders `planned` in plan mode.
    hardFail: registryState === 'unreachable',
    state: failing.length === 0 ? 'ready' : 'not-ready',
  }
}

export const id = 'preflight' as const

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyPreflightInputs(inputs as PreflightInputs, ctx)
}

export function plan(): StepPlan {
  // Read-only step: nothing to perform, plan and apply are the same reads.
  return { effects: [] }
}

export async function apply(): Promise<StepApplyResult> {
  return { effects: [] }
}

export { read as readPreflight }
