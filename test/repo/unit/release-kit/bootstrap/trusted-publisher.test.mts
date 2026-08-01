/**
 * @file Trust classification (FAIL CLOSED), plan argv order
 *   (revoke-then-create), the exact npm-web-auth argv, the missing-workflow
 *   derive-don't-assume refusal, and the apply lane through a fake execPty.
 */

import { describe, expect, it } from 'vitest'

import * as trustedPublisher from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/trusted-publisher.mts'
import { trustedPublisherLaw } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/trust-sweep.mts'
import { fakeSeams, fixture, makeCtx } from '../helpers.mts'

const LAW = trustedPublisherLaw('SocketDev/example')

function trustExec(stdout: string, code = 0) {
  return { code, stderr: '', stdout }
}

describe('classifyTrustList (fail closed)', () => {
  it('conforms fixture → conforms', () => {
    expect(
      trustedPublisher.classifyTrustList(
        trustExec(fixture('trust-list/conforms.json')),
        LAW,
      ),
    ).toEqual({ kind: 'conforms' })
  })

  it('stale-repo fixture → stale naming the repository field', () => {
    const result = trustedPublisher.classifyTrustList(
      trustExec(fixture('trust-list/stale-repo.json')),
      LAW,
    )
    expect(result.kind).toBe('stale')
    if (result.kind === 'stale') {
      expect(result.staleFields).toEqual(['repository'])
      expect(result.config.id).toBe('tp-002')
    }
  })

  it('clean exit without JSON → absent', () => {
    const stdout = (
      JSON.parse(fixture('trust-list/absent.json')) as { stdout: string }
    ).stdout
    expect(trustedPublisher.classifyTrustList(trustExec(stdout), LAW)).toEqual({
      kind: 'absent',
    })
  })

  it('auth-died fixture → auth-died, never "(no config)"', () => {
    const result = trustedPublisher.classifyTrustList(
      trustExec(fixture('trust-list/auth-died.txt'), 1),
      LAW,
    )
    expect(result.kind).toBe('auth-died')
  })

  it('an UNKNOWN JSON shape refuses (auth-died), never absent', () => {
    const result = trustedPublisher.classifyTrustList(
      trustExec(fixture('trust-list/unknown-shape.json')),
      LAW,
    )
    expect(result.kind).toBe('auth-died')
  })

  it('an error envelope on a clean exit still refuses', () => {
    const result = trustedPublisher.classifyTrustList(
      trustExec(
        '{"error":{"code":"EOTP","summary":"requires a one-time password"}}',
      ),
      LAW,
    )
    expect(result.kind).toBe('auth-died')
  })
})

describe('classify (step level)', () => {
  it('missing local npm-publish.yml → failed with the staged-config fix', () => {
    const detection = trustedPublisher.classifyTrustedPublisher(
      {
        trustList: trustExec(fixture('trust-list/conforms.json')),
        workflows: ['ci.yml'],
      },
      makeCtx(),
    )
    expect(detection.failed).toBe(true)
    const check = detection.checks.find(c => c.id === 'workflow-exists-locally')
    expect(check?.fix).toBe(
      'run: node scripts/socket-release/bootstrap.mts staged-config --apply',
    )
  })

  it('auth-died → authUnknown (plan planned / apply blocked handled by the runner)', () => {
    const detection = trustedPublisher.classifyTrustedPublisher(
      {
        trustList: trustExec(fixture('trust-list/auth-died.txt'), 1),
        workflows: ['npm-publish.yml'],
      },
      makeCtx(),
    )
    expect(detection.authUnknown).toBe(true)
    expect(detection.checks.find(c => c.id === 'trust-list-unknown')?.saw).toBe(
      'auth-unavailable',
    )
  })
})

describe('plan argv', () => {
  const workflows = ['npm-publish.yml']

  it('absent → one create with the exact npm-web-auth argv', () => {
    const ctx = makeCtx()
    const detection = trustedPublisher.classifyTrustedPublisher(
      { trustList: trustExec('No trusted publishers configured.'), workflows },
      ctx,
    )
    const plan = trustedPublisher.plan(detection, ctx)
    expect(plan.effects).toHaveLength(1)
    expect(plan.effects[0]!.description).toBe(
      'node scripts/socket-release/npm-web-auth.mts trust github @socketsecurity/example --file npm-publish.yml --repo SocketDev/example --env npm-publish --allow-publish --allow-stage-publish --yes',
    )
  })

  it('stale → revoke THEN create, in that order', () => {
    const ctx = makeCtx()
    const detection = trustedPublisher.classifyTrustedPublisher(
      {
        trustList: trustExec(fixture('trust-list/stale-repo.json')),
        workflows,
      },
      ctx,
    )
    const plan = trustedPublisher.plan(detection, ctx)
    expect(plan.effects).toHaveLength(2)
    expect(plan.effects[0]!.description).toContain('trust revoke')
    expect(plan.effects[1]!.description).toContain('trust github')
  })
})

describe('apply through fake execPty', () => {
  it('stale drives revoke (by live id) then create, both via execPty', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      exec: (cmd, args) =>
        cmd === 'npm' && args[0] === 'trust'
          ? trustExec(fixture('trust-list/stale-repo.json'))
          : undefined,
    })
    const detection = trustedPublisher.classifyTrustedPublisher(
      {
        trustList: trustExec(fixture('trust-list/stale-repo.json')),
        workflows: ['npm-publish.yml'],
      },
      ctx,
    )
    const plan = trustedPublisher.plan(detection, ctx)
    await trustedPublisher.apply(plan, ctx, fake.seams)
    const ptys = fake.calls.filter(c => c.kind === 'execPty')
    expect(ptys).toHaveLength(2)
    expect(ptys[0]!.args).toEqual([
      'scripts/socket-release/npm-web-auth.mts',
      'trust',
      'revoke',
      '@socketsecurity/example',
      '--id=tp-002',
    ])
    expect(ptys[1]!.args).toEqual([
      'scripts/socket-release/npm-web-auth.mts',
      'trust',
      'github',
      '@socketsecurity/example',
      '--file',
      'npm-publish.yml',
      '--repo',
      'SocketDev/example',
      '--env',
      'npm-publish',
      '--allow-publish',
      '--allow-stage-publish',
      '--yes',
    ])
  })

  it('a live conforming re-read at apply time performs zero writes', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      exec: (cmd, args) =>
        cmd === 'npm' && args[0] === 'trust'
          ? trustExec(fixture('trust-list/conforms.json'))
          : undefined,
    })
    const detection = trustedPublisher.classifyTrustedPublisher(
      {
        trustList: trustExec('No trusted publishers configured.'),
        workflows: ['npm-publish.yml'],
      },
      ctx,
    )
    const plan = trustedPublisher.plan(detection, ctx)
    const result = await trustedPublisher.apply(plan, ctx, fake.seams)
    expect(result.effects).toEqual([])
    expect(fake.calls.filter(c => c.kind === 'execPty')).toEqual([])
  })

  it('auth-death at apply time blocks on the npm-auth gate', async () => {
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({
      exec: (cmd, args) =>
        cmd === 'npm' && args[0] === 'trust'
          ? trustExec(fixture('trust-list/auth-died.txt'), 1)
          : undefined,
    })
    const detection = trustedPublisher.classifyTrustedPublisher(
      {
        trustList: trustExec('No trusted publishers configured.'),
        workflows: ['npm-publish.yml'],
      },
      ctx,
    )
    const plan = trustedPublisher.plan(detection, ctx)
    const result = await trustedPublisher.apply(plan, ctx, fake.seams)
    expect(result.gate?.name).toBe('npm auth')
    expect(fake.calls.filter(c => c.kind === 'execPty')).toEqual([])
  })
})
