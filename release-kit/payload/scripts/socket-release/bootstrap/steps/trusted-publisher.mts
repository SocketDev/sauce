/**
 * @file Step 6 — trusted-publisher: drive the registry-side trusted
 *   publisher config to the law (github · npm-publish.yml · env npm-publish
 *   · createPackage + createStagedPackage) via `npm trust` through the PTY
 *   router — the browser here is the OPERATOR'S browser via npm's web-2FA;
 *   the CDP/Playwright WRITE lane is dead (2026-07-31, 132/132) and MUST NOT
 *   be attempted. Derive-don't-assume: the local `.github/workflows` must
 *   actually carry npm-publish.yml before trust is configured for it (the
 *   cargo-twin lesson). Reads FAIL CLOSED: any `npm trust list` error
 *   envelope is auth-death, never "(no config)".
 */

import path from 'node:path'
import process from 'node:process'

import { npmAuthGate, webAuthApproveGate } from '../../_shared/human-gate.mts'
import {
  PACE_MS,
  conformsToLaw,
  trustedPublisherLaw,
} from '../../publish-infra/npm/trust-sweep.mts'
import type {
  TrustConfig,
  TrustedPublisherLaw,
} from '../../publish-infra/npm/trust-sweep.mts'
import { npmScratchCwd } from '../../publish-infra/npm/shared.mts'
import type {
  Check,
  Effect,
  StepApplyResult,
  StepContext,
  StepDetection,
  StepPlan,
} from '../plan.mts'
import type { BootstrapSeams, ExecResult } from '../seams.mts'

export const id = 'trusted-publisher' as const

export interface TrustedPublisherInputs {
  trustList: ExecResult
  workflows: string[]
}

export type TrustListClassification =
  | { kind: 'absent' }
  | { kind: 'auth-died'; saw: string }
  | { kind: 'conforms' }
  | { config: TrustConfig; kind: 'stale'; staleFields: string[] }

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<TrustedPublisherInputs> {
  return {
    trustList: await seams.exec(
      'npm',
      ['trust', 'list', ctx.packageName, '--json'],
      npmScratchCwd(),
    ),
    workflows: seams.listDir(path.join(ctx.repoRoot, '.github/workflows')),
  }
}

/**
 * Classify an `npm trust list --json` read against the law. FAIL CLOSED:
 * a non-zero exit, an error envelope, or an unrecognized JSON shape is
 * auth-death — never "(no config)" (the unauthenticated-reads-as-empty trap
 * produced a "132 unconfigured" audit against a fully configured registry,
 * twice). A genuinely unconfigured package is the clean-exit-without-config
 * shape ONLY. Pure — exported for tests.
 */
export function classifyTrustList(
  result: ExecResult,
  law: TrustedPublisherLaw,
): TrustListClassification {
  if (result.code !== 0) {
    return {
      kind: 'auth-died',
      saw:
        result.stderr.trim().split('\n')[0] ||
        result.stdout.trim().split('\n')[0] ||
        `exit ${result.code}`,
    }
  }
  const jsonStart = result.stdout.indexOf('{')
  if (jsonStart === -1) {
    // Clean exit with no JSON at all: the genuinely-unconfigured shape.
    return { kind: 'absent' }
  }
  let parsed: (TrustConfig & { error?: unknown }) | undefined
  try {
    parsed = JSON.parse(result.stdout.slice(jsonStart)) as TrustConfig & {
      error?: unknown
    }
  } catch {
    return { kind: 'auth-died', saw: 'unparseable trust list JSON' }
  }
  if (parsed.error) {
    return {
      kind: 'auth-died',
      saw: JSON.stringify(parsed.error).slice(0, 120),
    }
  }
  const recognizable =
    parsed.type !== undefined ||
    parsed.file !== undefined ||
    parsed.repository !== undefined ||
    parsed.environment !== undefined
  if (!recognizable) {
    // An unknown JSON shape must REFUSE, never read as unconfigured.
    return { kind: 'auth-died', saw: 'unrecognized trust list shape' }
  }
  if (conformsToLaw(parsed, law)) {
    return { kind: 'conforms' }
  }
  const staleFields: string[] = []
  if (parsed.type !== law.type) {
    staleFields.push('type')
  }
  if (parsed.file !== law.file) {
    staleFields.push('file')
  }
  if (parsed.repository !== law.repository) {
    staleFields.push('repository')
  }
  if (parsed.environment !== law.environment) {
    staleFields.push('environment')
  }
  const perms = [...(parsed.permissions ?? [])].toSorted()
  const wanted = [...law.permissions].toSorted()
  if (
    perms.length !== wanted.length ||
    !perms.every((p, i) => p === wanted[i])
  ) {
    staleFields.push('permissions')
  }
  return { config: parsed, kind: 'stale', staleFields }
}

export function classifyTrustedPublisher(
  inputs: TrustedPublisherInputs,
  ctx: StepContext,
): StepDetection {
  const checks: Check[] = []
  if (!inputs.workflows.includes('npm-publish.yml')) {
    checks.push({
      fix: 'run: node scripts/socket-release/bootstrap.mts staged-config --apply',
      id: 'workflow-exists-locally',
      ok: false,
      saw: 'no .github/workflows/npm-publish.yml',
      wanted:
        'the workflow trust binds to must exist before trust is configured for it',
    })
    return {
      checks,
      detail:
        'refusing to configure trust for a workflow that does not exist — run staged-config first.',
      done: false,
      failed: true,
      state: 'workflow-missing',
    }
  }
  checks.push({
    fix: null,
    id: 'workflow-exists-locally',
    ok: true,
    saw: 'npm-publish.yml present',
    wanted: 'the trust-bound workflow exists locally',
  })
  const law = trustedPublisherLaw(ctx.slug)
  const classification = classifyTrustList(inputs.trustList, law)
  if (classification.kind === 'auth-died') {
    checks.push({
      fix: 'log in (node scripts/socket-release/npm-web-auth.mts login) before --apply',
      id: 'trust-list-unknown',
      ok: false,
      saw: 'auth-unavailable',
      wanted: 'a parseable trust config list',
    })
    return {
      authUnknown: true,
      checks,
      detail: `Trusted-publisher read could not be trusted: npm trust returned an error envelope (${classification.saw}).`,
      done: false,
      state: 'auth-died',
    }
  }
  if (classification.kind === 'conforms') {
    checks.push({
      fix: null,
      id: 'trusted-publisher-conforms',
      ok: true,
      saw: 'type github, workflow npm-publish.yml, environment npm-publish, both permissions',
      wanted: `the law bound to ${ctx.slug}`,
    })
    return {
      checks,
      detail: `trusted publisher for ${ctx.packageName} conforms to the law.`,
      done: true,
      state: 'conforms',
    }
  }
  if (classification.kind === 'stale') {
    checks.push({
      fix: 'run: node scripts/socket-release/bootstrap.mts trusted-publisher --apply (revoke-then-create)',
      id: 'trusted-publisher-stale',
      ok: false,
      saw: `stale fields: ${classification.staleFields.join(', ')}`,
      wanted: `type github, repository ${ctx.slug}, workflow npm-publish.yml, environment npm-publish, permissions createPackage + createStagedPackage`,
    })
    return {
      checks,
      detail: `trusted publisher for ${ctx.packageName} is stale (${classification.staleFields.join(', ')}).`,
      done: false,
      state: 'stale',
    }
  }
  checks.push({
    fix: 'run: node scripts/socket-release/bootstrap.mts trusted-publisher --apply',
    id: 'trusted-publisher-absent',
    ok: false,
    saw: '(no config)',
    wanted: `the law bound to ${ctx.slug}`,
  })
  return {
    checks,
    detail: `no trusted publisher configured for ${ctx.packageName}.`,
    done: false,
    state: 'absent',
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyTrustedPublisher(inputs as TrustedPublisherInputs, ctx)
}

/**
 * The exact npm-web-auth argv(s) that take the current state to the law:
 * `absent` → create; `stale` → revoke (by id, read at apply time) then
 * create. Pure — exported for tests.
 */
export function trustCommandArgv(pkg: string, slug: string): string[] {
  return [
    'scripts/socket-release/npm-web-auth.mts',
    'trust',
    'github',
    pkg,
    '--file',
    'npm-publish.yml',
    '--repo',
    slug,
    '--env',
    'npm-publish',
    '--allow-publish',
    '--allow-stage-publish',
    '--yes',
  ]
}

export function trustRevokeArgv(pkg: string, configId: string): string[] {
  return [
    'scripts/socket-release/npm-web-auth.mts',
    'trust',
    'revoke',
    pkg,
    `--id=${configId}`,
  ]
}

export function plan(detection: StepDetection, ctx: StepContext): StepPlan {
  if (detection.done || detection.failed || detection.authUnknown) {
    return { effects: [] }
  }
  const effects: Effect[] = []
  if (detection.state === 'stale') {
    effects.push({
      applied: false,
      description: `node ${trustRevokeArgv(ctx.packageName, '<id>').join(' ')}`,
      kind: 'npm-trust',
    })
  }
  effects.push({
    applied: false,
    description: `node ${trustCommandArgv(ctx.packageName, ctx.slug).join(' ')}`,
    kind: 'npm-trust',
  })
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
  // Re-read at apply time for the live config id (revoke targets it).
  const inputs = await read(ctx, seams)
  const law = trustedPublisherLaw(ctx.slug)
  const classification = classifyTrustList(inputs.trustList, law)
  if (classification.kind === 'auth-died') {
    return {
      effects: [],
      gate: npmAuthGate(
        ctx.repoRoot,
        'the bootstrap resumes at trusted-publisher.',
      ),
    }
  }
  const effects: Effect[] = []
  if (classification.kind === 'conforms') {
    return { effects }
  }
  if (classification.kind === 'stale') {
    const configId = classification.config.id
    if (configId) {
      const revokeArgv = trustRevokeArgv(ctx.packageName, configId)
      const code = await seams.execPty(
        process.execPath,
        revokeArgv,
        ctx.repoRoot,
      )
      if (code !== 0) {
        throw new Error(
          `npm trust revoke for ${ctx.packageName} exited ${code} — the stale config still stands.`,
        )
      }
      effects.push({
        applied: true,
        description: `node ${revokeArgv.join(' ')}`,
        kind: 'npm-trust',
      })
      await new Promise(resolve => {
        setTimeout(resolve, PACE_MS)
      })
    }
  }
  const createArgv = trustCommandArgv(ctx.packageName, ctx.slug)
  const code = await seams.execPty(process.execPath, createArgv, ctx.repoRoot)
  effects.push({
    applied: code === 0,
    description: `node ${createArgv.join(' ')}`,
    kind: 'npm-trust',
  })
  if (code !== 0) {
    return {
      effects,
      gate: webAuthApproveGate(
        `the trusted-publisher create for ${ctx.packageName}`,
        'the bootstrap re-reads the trust config and resumes at trusted-publisher.',
      ),
    }
  }
  return { effects }
}
