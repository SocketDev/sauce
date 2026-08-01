/**
 * @file Preflight classification over inline inputs: every check's
 *   pass/fail arm, the fail-closed registry rule (unreachable is NEVER
 *   `unpublished`), and the informational private-repo note.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyPackument,
  classifyPreflightInputs,
  nodeVersionOk,
} from '../../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/preflight.mts'
import type { PreflightInputs } from '../../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/preflight.mts'
import {
  OK,
  fixture,
  livePackument,
  makeCtx,
  unreachableRegistry,
} from '../../helpers.mts'

function goodInputs(): PreflightInputs {
  return {
    deps: { lib: true, playwright: true, sdk: true },
    ghAuth: OK,
    ghRepo: {
      code: 0,
      stderr: '',
      stdout: JSON.stringify({ default_branch: 'main', visibility: 'private' }),
    },
    gitOrigin: {
      code: 0,
      stderr: '',
      stdout: 'https://github.com/SocketDev/example.git\n',
    },
    npmTrustHelp: OK,
    packageJsonRaw: JSON.stringify({
      files: ['dist'],
      name: '@socketsecurity/example',
      packageManager: 'pnpm@11.17.0',
      version: '1.0.0',
    }),
    packument: livePackument(),
    pnpmStageHelp: OK,
  }
}

function checkById(inputs: PreflightInputs, id: string, ctx = makeCtx()) {
  const detection = classifyPreflightInputs(inputs, ctx)
  return detection.checks.find(c => c.id === id)
}

describe('nodeVersionOk', () => {
  it('accepts the floor and above, rejects below', () => {
    expect(nodeVersionOk('v22.18.0')).toBe(true)
    expect(nodeVersionOk('v24.1.0')).toBe(true)
    expect(nodeVersionOk('v22.17.9')).toBe(false)
    expect(nodeVersionOk('v20.11.0')).toBe(false)
    expect(nodeVersionOk('garbage')).toBe(false)
  })
})

describe('classifyPackument (fail closed)', () => {
  it('live / unpublished / unreachable are the only answers', () => {
    expect(classifyPackument(livePackument())).toBe('live')
    expect(classifyPackument({ body: {}, status: 404 })).toBe('unpublished')
    expect(classifyPackument(unreachableRegistry())).toBe('unreachable')
    // A 5xx is unreachable, NEVER unpublished.
    expect(classifyPackument({ body: undefined, status: 503 })).toBe(
      'unreachable',
    )
  })

  it('a garbled 200 body never reads as live', () => {
    const garbled = {
      body: JSON.parse(fixture('packument/garbled.json')),
      status: 200,
    }
    expect(classifyPackument(garbled)).toBe('unpublished')
  })
})

describe('classifyPreflightInputs', () => {
  it('all-green inputs pass and are done', () => {
    const detection = classifyPreflightInputs(goodInputs(), makeCtx())
    expect(detection.done).toBe(true)
    expect(detection.checks.filter(c => !c.ok)).toEqual([])
  })

  it('a private repo adds an informational provenance note (ok: true)', () => {
    const check = checkById(goodInputs(), 'provenance-expectation')
    expect(check?.ok).toBe(true)
    expect(check?.saw).toContain('provenance disabled')
  })

  it('node below the floor fails node-version', () => {
    const check = checkById(
      goodInputs(),
      'node-version',
      makeCtx({ nodeVersion: 'v20.0.0' }),
    )
    expect(check?.ok).toBe(false)
  })

  it('a non-GitHub origin fails git-origin-github with the set-url fix', () => {
    const inputs = goodInputs()
    inputs.gitOrigin = {
      code: 0,
      stderr: '',
      stdout: 'https://gitlab.com/x/y.git\n',
    }
    const check = checkById(inputs, 'git-origin-github')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toContain('git remote set-url origin')
  })

  it('a pinned pnpm without stage support fails with the exact bump fix', () => {
    const inputs = goodInputs()
    inputs.pnpmStageHelp = { code: 1, stderr: '', stdout: '' }
    const check = checkById(inputs, 'pnpm-stage-support')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toContain('pnpm@11.17.0')
    expect(check?.fix).toContain('pnpm/action-setup reads packageManager')
  })

  it('npm without trust support fails with the upgrade fix', () => {
    const inputs = goodInputs()
    inputs.npmTrustHelp = { code: 1, stderr: '', stdout: '' }
    const check = checkById(inputs, 'npm-trust-support')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toContain('npm trust')
  })

  it('gh auth failure fails gh-auth', () => {
    const inputs = goodInputs()
    inputs.ghAuth = { code: 1, stderr: 'not logged in', stdout: '' }
    expect(checkById(inputs, 'gh-auth')?.ok).toBe(false)
  })

  it('a missing kit dep fails with the exact pnpm add -D line', () => {
    const inputs = goodInputs()
    inputs.deps = { lib: true, playwright: false, sdk: true }
    const check = checkById(inputs, 'kit-deps-resolvable')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toContain(
      'pnpm add -D @socketsecurity/lib@6.5.2 @socketsecurity/sdk@4.1.3 playwright-core@1.61.1',
    )
  })

  it('an unreachable registry FAILS registry-reachable (never unpublished)', () => {
    const inputs = goodInputs()
    inputs.packument = unreachableRegistry()
    const check = checkById(inputs, 'registry-reachable')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toContain('never read as an unclaimed name')
    const detection = classifyPreflightInputs(inputs, makeCtx())
    expect(detection.failed).toBe(true)
  })

  it('a definitive 404 PASSES registry-reachable', () => {
    const inputs = goodInputs()
    inputs.packument = { body: {}, status: 404 }
    expect(checkById(inputs, 'registry-reachable')?.ok).toBe(true)
  })

  it('a scoped package without access fails access-resolved (§6 fields)', () => {
    const check = checkById(
      goodInputs(),
      'access-resolved',
      makeCtx({ access: undefined }),
    )
    expect(check?.ok).toBe(false)
    expect(check?.saw).toContain('none of')
    expect(check?.wanted).toBe('public or restricted')
    expect(check?.fix).toContain('--access restricted')
  })

  it('a bad packageManager pin fails package-manifest', () => {
    const inputs = goodInputs()
    inputs.packageJsonRaw = JSON.stringify({
      files: ['dist'],
      name: 'x',
      packageManager: 'pnpm@11',
      version: '1.0.0',
    })
    expect(checkById(inputs, 'package-manifest')?.ok).toBe(false)
  })
})
