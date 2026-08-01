/**
 * @file Environment probes: the six probe states over the gh-env fixtures,
 *   the exact `gh api` argv fixes (PUT flags, list-before-POST, one POST per
 *   missing branch), the 403 gate, idempotent second apply, and the
 *   garbled-response refusal (never restricted-ok by default).
 */

import { describe, expect, it } from 'vitest'

import * as githubEnv from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/github-env.mts'
import { OK, fakeSeams, fixture, makeCtx } from '../helpers.mts'

const envList = (name: string) => ({
  code: 0,
  stderr: '',
  stdout: fixture(`gh-env/${name}.json`),
})
const forbidden = {
  code: 1,
  stderr: fixture('gh-env/forbidden-403.txt'),
  stdout: '',
}

describe('desiredEnvironments', () => {
  it('maps channels to their environments, deduped', () => {
    expect(
      githubEnv.desiredEnvironments(['npm', 'github-release', 'npm']),
    ).toEqual(['npm-publish', 'github-release'])
    expect(githubEnv.desiredEnvironments(['brew', 'crates'])).toEqual([
      'brew-publish',
      'cargo-publish',
    ])
  })
})

describe('classifyEnvProbe', () => {
  const base = { branch: 'main', env: 'npm-publish' }

  it('missing / unrestricted / wrong-branch / restricted-ok over fixtures', () => {
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: envList('missing'),
        policy: OK,
      }),
    ).toBe('missing')
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: envList('unrestricted'),
        policy: OK,
      }),
    ).toBe('unrestricted')
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: envList('wrong-branch'),
        policy: envList('wrong-branch-policies'),
      }),
    ).toBe('wrong-branch')
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: envList('restricted'),
        policy: envList('restricted-policies'),
      }),
    ).toBe('restricted-ok')
  })

  it('403 → forbidden', () => {
    expect(
      githubEnv.classifyEnvProbe({ ...base, envList: forbidden, policy: OK }),
    ).toBe('forbidden')
  })

  it('garbled env JSON refuses — never restricted-ok', () => {
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: { code: 0, stderr: '', stdout: 'not json at all' },
        policy: OK,
      }),
    ).toBe('garbled')
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: { code: 0, stderr: '', stdout: '{"unexpected": true}' },
        policy: OK,
      }),
    ).toBe('garbled')
    // Restricted env but a garbled policies list is still not restricted-ok.
    expect(
      githubEnv.classifyEnvProbe({
        ...base,
        envList: envList('restricted'),
        policy: { code: 0, stderr: '', stdout: '<html>rate limited</html>' },
      }),
    ).toBe('garbled')
  })
})

describe('classifyEnvProbes (step level)', () => {
  it('403 blocks on the gh-env gate', () => {
    const detection = githubEnv.classifyEnvProbes(
      { envList: forbidden, policies: {} },
      makeCtx(),
    )
    expect(detection.gate?.name).toBe('github environment')
    expect(detection.done).toBe(false)
  })

  it('garbled fails, never passes', () => {
    const detection = githubEnv.classifyEnvProbes(
      {
        envList: { code: 0, stderr: '', stdout: 'nonsense' },
        policies: {},
      },
      makeCtx(),
    )
    expect(detection.failed).toBe(true)
  })
})

describe('planEnvFixes', () => {
  it('emits the EXACT gh api argv: idempotent PUT then list-before-POST', () => {
    const fixes = githubEnv.planEnvFixes({
      branch: 'main',
      envs: ['npm-publish'],
      slug: 'SocketDev/example',
    })
    expect(fixes).toHaveLength(2)
    expect(fixes[0]!.argv).toEqual([
      'api',
      '-X',
      'PUT',
      'repos/SocketDev/example/environments/npm-publish',
      '-F',
      'deployment_branch_policy[protected_branches]=false',
      '-F',
      'deployment_branch_policy[custom_branch_policies]=true',
    ])
    expect(fixes[1]!.argv).toEqual([
      'api',
      '-X',
      'POST',
      'repos/SocketDev/example/environments/npm-publish/deployment-branch-policies',
      '-f',
      'name=main',
      '-f',
      'type=branch',
    ])
    expect(fixes[1]!.listBeforePost).toEqual([
      'api',
      'repos/SocketDev/example/environments/npm-publish/deployment-branch-policies',
      '--jq',
      '[.branch_policies[].name]',
    ])
  })

  it('one POST per env, none for an empty env list', () => {
    expect(
      githubEnv.planEnvFixes({ branch: 'main', envs: [], slug: 'a/b' }),
    ).toEqual([])
  })
})

describe('apply (idempotency via exec recorder)', () => {
  it('a restricted-ok state plans zero mutating calls', async () => {
    const ctx = makeCtx({ apply: true, channels: ['npm'] })
    const detection = githubEnv.classifyEnvProbes(
      {
        envList: envList('restricted'),
        policies: { 'npm-publish': envList('restricted-policies') },
      },
      ctx,
    )
    expect(detection.done).toBe(true)
    const plan = githubEnv.plan(detection, ctx)
    expect(plan.effects).toEqual([])
    const fake = fakeSeams()
    const result = await githubEnv.apply(plan, ctx, fake.seams)
    expect(result.effects).toEqual([])
    expect(fake.calls).toEqual([])
  })

  it('the POST is skipped when the branch policy already exists', async () => {
    const ctx = makeCtx({ apply: true, channels: ['npm'] })
    const detection = githubEnv.classifyEnvProbes(
      {
        envList: envList('unrestricted'),
        policies: { 'npm-publish': OK },
      },
      ctx,
    )
    const plan = githubEnv.plan(detection, ctx)
    const fake = fakeSeams({
      exec: (_cmd, args) =>
        args.includes('--jq')
          ? { code: 0, stderr: '', stdout: '["main"]' }
          : { code: 0, stderr: '', stdout: '{}' },
    })
    const result = await githubEnv.apply(plan, ctx, fake.seams)
    const posts = fake.calls.filter(c => c.args.includes('POST'))
    expect(posts).toHaveLength(0)
    const puts = fake.calls.filter(c => c.args.includes('PUT'))
    expect(puts).toHaveLength(1)
    expect(result.effects.filter(e => e.applied)).toHaveLength(1)
  })
})
