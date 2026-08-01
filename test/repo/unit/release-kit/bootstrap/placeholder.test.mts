/**
 * @file Placeholder detection + consent policy: live short-circuit, staged
 *   promote gate, plan-vs-apply auth semantics, fail-closed registry, the
 *   reserve gate with ZERO publish effects, --reserve mismatch as usage,
 *   and the apply path invoking runPlaceholder exactly once — plus the
 *   amendment's permissive-after-publish ordering.
 */

import { describe, expect, it } from 'vitest'

import * as placeholder from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/placeholder.mts'
import { PERMISSIVE_ACCESS } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-plan.mts'
import {
  fakeSeams,
  fixture,
  livePackument,
  makeCtx,
  unpublishedPackument,
  unreachableRegistry,
} from '../helpers.mts'

const emptyStage = {
  code: 0,
  stderr: '',
  stdout: fixture('stage-list/empty.txt'),
}
const twoStaged = {
  code: 0,
  stderr: '',
  stdout: fixture('stage-list/two-staged.txt'),
}
const authFailed = {
  code: 1,
  stderr: '',
  stdout: fixture('stage-list/auth-failed.txt'),
}
const spinnerNoise = {
  code: 0,
  stderr: '',
  stdout: fixture('stage-list/spinner-noise.txt'),
}

describe('classifyPlaceholderState', () => {
  it('live → done (double-publish structurally unreachable)', () => {
    const detection = placeholder.classifyPlaceholderState(
      { packument: livePackument(), stageList: undefined },
      makeCtx(),
    )
    expect(detection.done).toBe(true)
    expect(detection.state).toBe('live')
  })

  it('staged entry → blocked with the promote gate carrying the stageId', () => {
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: twoStaged },
      makeCtx(),
    )
    expect(detection.state).toBe('staged-pending')
    expect(detection.gate?.name).toBe('placeholder promote')
    expect(detection.detail).toContain('stage-0001')
  })

  it('spinner noise before the JSON still parses to the staged entry', () => {
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: spinnerNoise },
      makeCtx(),
    )
    expect(detection.state).toBe('staged-pending')
    expect(detection.detail).toContain('stage-0003')
  })

  it('auth-dead stage list → authUnknown with the auth-unavailable check', () => {
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: authFailed },
      makeCtx(),
    )
    expect(detection.authUnknown).toBe(true)
    const check = detection.checks.find(c => c.id === 'stage-list-unknown')
    expect(check?.saw).toBe('auth-unavailable')
    expect(check?.fix).toContain('npm-web-auth.mts login')
  })

  it('unreachable registry → failed with the §6 fields (never unclaimed)', () => {
    const detection = placeholder.classifyPlaceholderState(
      { packument: unreachableRegistry(), stageList: emptyStage },
      makeCtx(),
    )
    expect(detection.failed).toBe(true)
    expect(detection.detail).toContain('Refusing to classify')
    const check = detection.checks.find(c => c.id === 'registry-read')
    expect(check?.fix).toContain('never read as an unclaimed name')
  })

  it('a scoped package with no resolved access refuses before planning', () => {
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      makeCtx({ access: undefined }),
    )
    expect(detection.failed).toBe(true)
    const check = detection.checks.find(c => c.id === 'access-resolved')
    expect(check?.saw).toBe('none of them is set')
    expect(check?.wanted).toBe('public or restricted')
  })
})

describe('plan (consent policy)', () => {
  const unclaimed = () =>
    placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      makeCtx(),
    )

  it('apply without --reserve → the reserve gate; --yes never substitutes', () => {
    const plan = placeholder.plan(
      unclaimed(),
      makeCtx({ apply: true, yes: true }),
    )
    expect(plan.gate?.name).toBe('reserve name')
    expect(plan.usage).toBeUndefined()
  })

  it('a mismatched --reserve is a usage refusal naming saw/wanted', () => {
    const plan = placeholder.plan(
      unclaimed(),
      makeCtx({ apply: true, reserve: '@socketsecurity/wrong' }),
    )
    expect(plan.usage).toEqual({
      saw: '@socketsecurity/wrong',
      wanted: '@socketsecurity/example',
    })
  })

  it('a byte-equal --reserve plans the publish with no gate', () => {
    const plan = placeholder.plan(
      unclaimed(),
      makeCtx({ apply: true, reserve: '@socketsecurity/example' }),
    )
    expect(plan.gate).toBeUndefined()
    expect(plan.effects.some(e => e.kind === 'registry-publish')).toBe(true)
    expect(plan.effects.some(e => e.kind === 'npm-access')).toBe(true)
  })

  it('plan mode carries the same effects, nothing performed', () => {
    const plan = placeholder.plan(unclaimed(), makeCtx())
    expect(plan.effects[0]!.applied).toBe(false)
  })
})

describe('apply', () => {
  it('a blocked plan (no --reserve) performs ZERO publish effects', async () => {
    const { placeholderCalls, seams } = fakeSeams()
    const ctx = makeCtx({ apply: true })
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      ctx,
    )
    const plan = placeholder.plan(detection, ctx)
    expect(plan.gate).toBeDefined()
    // The runner never calls apply when plan carries a gate; the invariant
    // here is that planning alone drove no seam at all.
    expect(placeholderCalls).toHaveLength(0)
    expect(seams).toBeDefined()
  })

  it('with --reserve invokes runPlaceholder once with the expected access', async () => {
    const fake = fakeSeams({
      registry: () => livePackument(),
    })
    const ctx = makeCtx({ apply: true, reserve: '@socketsecurity/example' })
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      ctx,
    )
    const plan = placeholder.plan(detection, ctx)
    const result = await placeholder.apply(plan, ctx, fake.seams)
    expect(fake.placeholderCalls).toEqual([
      {
        access: 'restricted',
        apply: true,
        names: ['@socketsecurity/example'],
      },
    ])
    expect(result.gate).toBeUndefined()
    // Post-publish re-read was live → no access write needed (never re-widen).
    expect(fake.accessWrites).toHaveLength(0)
  })

  it('dead npm identity blocks on the npm-auth gate with zero publishes', async () => {
    const fake = fakeSeams({ identity: false })
    const ctx = makeCtx({ apply: true, reserve: '@socketsecurity/example' })
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      ctx,
    )
    const plan = placeholder.plan(detection, ctx)
    const result = await placeholder.apply(plan, ctx, fake.seams)
    expect(result.gate?.name).toBe('npm auth')
    expect(fake.placeholderCalls).toHaveLength(0)
  })

  it('AMENDMENT ordering: publish first, then permissive while still pending', async () => {
    // The post-publish re-read stays 404 (staged-pending on a staging
    // account); the access read shows direct disabled → the apply widens to
    // PERMISSIVE right after the publish, never before.
    const fake = fakeSeams({
      accessReads: [
        { directEnabled: false, stagedEnabled: true, state: 'staged-only' },
      ],
      registry: () => unpublishedPackument(),
    })
    const ctx = makeCtx({ apply: true, reserve: '@socketsecurity/example' })
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      ctx,
    )
    const plan = placeholder.plan(detection, ctx)
    const result = await placeholder.apply(plan, ctx, fake.seams)
    expect(fake.placeholderCalls).toHaveLength(1)
    expect(fake.accessWrites).toEqual([
      { desired: PERMISSIVE_ACCESS, pkg: '@socketsecurity/example' },
    ])
    expect(result.effects.some(e => e.kind === 'npm-access' && e.applied)).toBe(
      true,
    )
  })

  it('an unreadable access page after publish skips the widen (refuse, not guess)', async () => {
    const fake = fakeSeams({
      accessReads: [
        {
          directEnabled: undefined,
          stagedEnabled: undefined,
          state: 'unknown',
        },
      ],
      registry: () => unpublishedPackument(),
    })
    const ctx = makeCtx({ apply: true, reserve: '@socketsecurity/example' })
    const detection = placeholder.classifyPlaceholderState(
      { packument: unpublishedPackument(), stageList: emptyStage },
      ctx,
    )
    const plan = placeholder.plan(detection, ctx)
    await placeholder.apply(plan, ctx, fake.seams)
    expect(fake.accessWrites).toHaveLength(0)
  })
})
