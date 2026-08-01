/**
 * @file The publishing-access machinery (owner directive): the pure parser
 *   over the three golden HTML states + the unknown-shape refusal, the diff
 *   planner's refuse-on-unknown, and the two bootstrap steps' classify —
 *   permissive never re-widens a live package; staged-only is the terminal
 *   done-predicate.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyPublishingAccess,
  parsePublishingAccess,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-parse.mts'
import {
  PERMISSIVE_ACCESS,
  STAGED_ONLY_ACCESS,
  accessMatchesDesired,
  diffPublishingAccess,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-plan.mts'
import * as permissive from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/npm-access-permissive.mts'
import * as stagedOnly from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/npm-access-staged-only.mts'
import {
  fakeSeams,
  fixture,
  livePackument,
  makeCtx,
  unpublishedPackument,
} from '../helpers.mts'

describe('parsePublishingAccess over the golden pages', () => {
  it('both-enabled.html → both-enabled', () => {
    const read = parsePublishingAccess(
      fixture('access-pages/both-enabled.html'),
    )
    expect(read).toEqual({
      directEnabled: true,
      stagedEnabled: true,
      state: 'both-enabled',
    })
  })

  it('staged-only.html → staged-only', () => {
    const read = parsePublishingAccess(fixture('access-pages/staged-only.html'))
    expect(read.state).toBe('staged-only')
    expect(read.directEnabled).toBe(false)
  })

  it('direct-only.html (escaped JSON fallback) → direct-only', () => {
    const read = parsePublishingAccess(fixture('access-pages/direct-only.html'))
    expect(read).toEqual({
      directEnabled: true,
      stagedEnabled: false,
      state: 'direct-only',
    })
  })

  it('an unknown page shape REFUSES with state unknown — never a default', () => {
    const read = parsePublishingAccess(
      fixture('access-pages/unknown-shape.html'),
    )
    expect(read.state).toBe('unknown')
    expect(read.directEnabled).toBeUndefined()
  })

  it('classifyPublishingAccess treats a half-read as unknown', () => {
    expect(classifyPublishingAccess(true, undefined)).toBe('unknown')
    expect(classifyPublishingAccess(undefined, true)).toBe('unknown')
    expect(classifyPublishingAccess(false, false)).toBe('unknown')
  })
})

describe('diffPublishingAccess', () => {
  it('plans the exact checkbox edits to the terminal shape', () => {
    const read = parsePublishingAccess(
      fixture('access-pages/both-enabled.html'),
    )
    expect(diffPublishingAccess(read, STAGED_ONLY_ACCESS)).toEqual([
      { checkbox: 'allowDirectPublish', to: false },
    ])
    const direct = parsePublishingAccess(
      fixture('access-pages/direct-only.html'),
    )
    expect(diffPublishingAccess(direct, STAGED_ONLY_ACCESS)).toEqual([
      { checkbox: 'allowDirectPublish', to: false },
      { checkbox: 'allowStagedPublish', to: true },
    ])
  })

  it('refuses to plan against an unknown read', () => {
    const read = parsePublishingAccess(
      fixture('access-pages/unknown-shape.html'),
    )
    expect(() => diffPublishingAccess(read, PERMISSIVE_ACCESS)).toThrowError(
      /Refusing to plan/,
    )
  })

  it('accessMatchesDesired never matches an unknown read', () => {
    const read = parsePublishingAccess(
      fixture('access-pages/unknown-shape.html'),
    )
    expect(accessMatchesDesired(read, STAGED_ONLY_ACCESS)).toBe(false)
  })
})

describe('npm-access-permissive step', () => {
  it('a live name is already-done — a re-run NEVER re-widens', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({ registry: () => livePackument() })
    const inputs = await permissive.read(ctx, fake.seams)
    const detection = permissive.classifyAccessPermissive(inputs, ctx)
    expect(detection.done).toBe(true)
    expect(detection.state).toBe('live')
    // The browser read lane was never opened for a live name.
    expect(fake.accessWrites).toEqual([])
    const plan = permissive.plan(detection, ctx)
    expect(plan.effects).toEqual([])
  })

  it('plan mode defers the browser read and reports planned work', async () => {
    const ctx = makeCtx({ apply: false })
    const fake = fakeSeams({ registry: () => unpublishedPackument() })
    const inputs = await permissive.read(ctx, fake.seams)
    expect(inputs.access).toBeUndefined()
    const detection = permissive.classifyAccessPermissive(inputs, ctx)
    expect(detection.done).toBe(false)
    expect(detection.state).toBe('pending-unread')
    const plan = permissive.plan(detection, ctx)
    expect(plan.effects.map(e => e.kind)).toEqual(['npm-access'])
    expect(plan.effects[0]!.applied).toBe(false)
  })

  it('a pending placeholder with direct disabled applies PERMISSIVE', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      accessReads: [
        { directEnabled: false, stagedEnabled: true, state: 'staged-only' },
      ],
      registry: () => unpublishedPackument(),
    })
    const inputs = await permissive.read(ctx, fake.seams)
    const detection = permissive.classifyAccessPermissive(inputs, ctx)
    expect(detection.done).toBe(false)
    const plan = permissive.plan(detection, ctx)
    const result = await permissive.apply(plan, ctx, fake.seams)
    expect(fake.accessWrites).toEqual([
      { desired: PERMISSIVE_ACCESS, pkg: '@socketsecurity/example' },
    ])
    expect(result.gate).toBeUndefined()
  })

  it('a not-yet-created package (unreadable page) is done with the defaults note', async () => {
    const ctx = makeCtx({ apply: true })
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
    const inputs = await permissive.read(ctx, fake.seams)
    const detection = permissive.classifyAccessPermissive(inputs, ctx)
    expect(detection.done).toBe(true)
    expect(detection.state).toBe('not-created')
  })
})

describe('npm-access-staged-only step', () => {
  it('staged-only reads as done (idempotent no-op)', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      accessReads: [
        { directEnabled: false, stagedEnabled: true, state: 'staged-only' },
      ],
      registry: () => livePackument(),
    })
    const inputs = await stagedOnly.read(ctx, fake.seams)
    const detection = stagedOnly.classifyAccessStagedOnly(inputs, ctx)
    expect(detection.done).toBe(true)
    const plan = stagedOnly.plan(detection, ctx)
    const result = await stagedOnly.apply(plan, ctx, fake.seams)
    expect(result.effects).toEqual([])
    expect(fake.accessWrites).toEqual([])
  })

  it('both-enabled plans + applies the STAGED_ONLY tighten', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      accessReads: [
        { directEnabled: true, stagedEnabled: true, state: 'both-enabled' },
      ],
      registry: () => livePackument(),
    })
    const inputs = await stagedOnly.read(ctx, fake.seams)
    const detection = stagedOnly.classifyAccessStagedOnly(inputs, ctx)
    expect(detection.done).toBe(false)
    const plan = stagedOnly.plan(detection, ctx)
    expect(plan.effects.map(e => e.kind)).toEqual(['npm-access'])
    await stagedOnly.apply(plan, ctx, fake.seams)
    expect(fake.accessWrites).toEqual([
      { desired: STAGED_ONLY_ACCESS, pkg: '@socketsecurity/example' },
    ])
  })

  it('a not-live package fails with the --reserve fix (tighten never precedes the publish)', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({ registry: () => unpublishedPackument() })
    const inputs = await stagedOnly.read(ctx, fake.seams)
    const detection = stagedOnly.classifyAccessStagedOnly(inputs, ctx)
    expect(detection.failed).toBe(true)
    expect(
      detection.checks.find(c => c.id === 'registry-name-live')?.fix,
    ).toContain('--reserve @socketsecurity/example')
  })

  it('an unreadable page blocks on the browser-session gate (refuse, never classify)', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      accessReads: [
        {
          directEnabled: undefined,
          stagedEnabled: undefined,
          state: 'unknown',
        },
      ],
      registry: () => livePackument(),
    })
    const inputs = await stagedOnly.read(ctx, fake.seams)
    const detection = stagedOnly.classifyAccessStagedOnly(inputs, ctx)
    expect(detection.gate?.name).toBe('browser session')
    expect(detection.done).toBe(false)
  })
})
