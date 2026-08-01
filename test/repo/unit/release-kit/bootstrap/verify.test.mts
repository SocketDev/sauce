/**
 * @file Verify aggregation over seam fixtures: all-green passed detail,
 *   staged-pending block, the unclaimed --reserve fix, workflows-on-origin,
 *   the amendment's terminal staged-only assertion (permissive = FAIL with
 *   the remediation command), and the negative org-secret test.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as verify from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/verify.mts'
import type { VerifyInputs } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/verify.mts'
import { KIT_SCRIPTS } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/staged-config.mts'
import {
  fixture,
  livePackument,
  makeCtx,
  unpublishedPackument,
} from '../helpers.mts'

const PAYLOAD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../release-kit/payload/scripts/socket-release',
)
const NPM_TEMPLATE = readFileSync(
  path.join(PAYLOAD, 'templates/workflows/npm-publish.yml'),
  'utf8',
)
const GHR_TEMPLATE = readFileSync(
  path.join(PAYLOAD, 'templates/workflows/github-release.yml'),
  'utf8',
)

const OK = { code: 0, stderr: '', stdout: '' }

function greenInputs(): VerifyInputs {
  const pkg = `${JSON.stringify({
    name: '@socketsecurity/example',
    publishConfig: { access: 'restricted' },
    scripts: { ...KIT_SCRIPTS },
    version: '1.0.0',
  })}\n`
  return {
    access: { directEnabled: false, stagedEnabled: true, state: 'staged-only' },
    envList: { code: 0, stderr: '', stdout: fixture('gh-env/restricted.json') },
    packument: livePackument(),
    pnpmStageHelp: OK,
    policies: {
      'github-release': {
        code: 0,
        stderr: '',
        stdout: fixture('gh-env/restricted-policies.json').replaceAll(
          'npm-publish',
          'github-release',
        ),
      },
      'npm-publish': {
        code: 0,
        stderr: '',
        stdout: fixture('gh-env/restricted-policies.json'),
      },
    },
    stagedConfig: {
      gitignore: '# socket-release-kit\n.cache/\n',
      packageJsonRaw: pkg,
      targets: {
        'github-release.yml': GHR_TEMPLATE,
        'npm-publish.yml': NPM_TEMPLATE,
      },
      templates: {
        'github-release.yml': GHR_TEMPLATE,
        'npm-publish.yml': NPM_TEMPLATE,
      },
    },
    stageList: undefined,
    trustList: {
      code: 0,
      stderr: '',
      stdout: fixture('trust-list/conforms.json'),
    },
    workflowsOnOrigin: {
      'github-release.yml': OK,
      'npm-publish.yml': OK,
    },
  }
}

// The green fixture's env list only carries npm-publish; give github-release
// its own restricted entry by widening the envList JSON.
function greenInputsBothEnvs(): VerifyInputs {
  const inputs = greenInputs()
  const envDoc = JSON.parse(inputs.envList.stdout) as {
    environments: Array<Record<string, unknown>>
  }
  envDoc.environments.push({
    ...envDoc.environments[0]!,
    name: 'github-release',
  })
  inputs.envList = { code: 0, stderr: '', stdout: JSON.stringify(envDoc) }
  return inputs
}

describe('classifyVerify', () => {
  it('all green → passed with the stood-up next-release detail', () => {
    const ctx = makeCtx({ apply: true })
    const detection = verify.classifyVerify(greenInputsBothEnvs(), ctx)
    expect(detection.checks.filter(c => !c.ok)).toEqual([])
    expect(detection.done).toBe(true)
    expect(detection.detail).toContain('publishing is stood up')
    expect(detection.detail).toContain('chore: bump version to')
  })

  it('staged-pending → blocked on the promote gate', () => {
    const inputs = greenInputsBothEnvs()
    inputs.packument = unpublishedPackument()
    inputs.stageList = {
      code: 0,
      stderr: '',
      stdout: fixture('stage-list/two-staged.txt'),
    }
    const detection = verify.classifyVerify(inputs, makeCtx({ apply: true }))
    expect(detection.gate?.name).toBe('placeholder promote')
  })

  it('unclaimed → failed with the exact --reserve fix', () => {
    const inputs = greenInputsBothEnvs()
    inputs.packument = unpublishedPackument()
    inputs.stageList = {
      code: 0,
      stderr: '',
      stdout: fixture('stage-list/empty.txt'),
    }
    const detection = verify.classifyVerify(inputs, makeCtx({ apply: true }))
    expect(detection.failed).toBe(true)
    expect(detection.checks.find(c => c.id === 'registry-name-live')?.fix).toBe(
      'node scripts/socket-release/bootstrap.mts placeholder --apply --reserve @socketsecurity/example',
    )
  })

  it('a workflow absent from origin fails workflows-on-origin', () => {
    const inputs = greenInputsBothEnvs()
    inputs.workflowsOnOrigin['npm-publish.yml'] = {
      code: 1,
      stderr: 'HTTP 404',
      stdout: '',
    }
    const detection = verify.classifyVerify(inputs, makeCtx({ apply: true }))
    const check = detection.checks.find(c => c.id === 'workflows-on-origin')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toContain('commit and push')
  })

  it('AMENDMENT: a package left permissive FAILS with the tighten command', () => {
    const inputs = greenInputsBothEnvs()
    inputs.access = {
      directEnabled: true,
      stagedEnabled: true,
      state: 'both-enabled',
    }
    const detection = verify.classifyVerify(inputs, makeCtx({ apply: true }))
    expect(detection.failed).toBe(true)
    const check = detection.checks.find(c => c.id === 'npm-access-staged-only')
    expect(check?.ok).toBe(false)
    expect(check?.fix).toBe(
      'run: node scripts/socket-release/bootstrap.mts npm-access-staged-only --apply',
    )
  })

  it('trust auth-death renders auth-unavailable (plan-mode planned semantics)', () => {
    const inputs = greenInputsBothEnvs()
    inputs.trustList = {
      code: 1,
      stderr: '',
      stdout: fixture('trust-list/auth-died.txt'),
    }
    const detection = verify.classifyVerify(inputs, makeCtx({ apply: true }))
    expect(detection.authUnknown).toBe(true)
    expect(
      detection.checks.find(c => c.id === 'trusted-publisher-conforms')?.saw,
    ).toBe('auth-unavailable')
  })

  it('NEGATIVE: no verify output ever names an org secret as human work', () => {
    const scenarios = [
      greenInputsBothEnvs(),
      (() => {
        const inputs = greenInputsBothEnvs()
        inputs.envList = { code: 1, stderr: 'HTTP 403', stdout: '' }
        return inputs
      })(),
      (() => {
        const inputs = greenInputsBothEnvs()
        inputs.access = {
          directEnabled: true,
          stagedEnabled: true,
          state: 'both-enabled',
        }
        return inputs
      })(),
    ]
    for (const inputs of scenarios) {
      const detection = verify.classifyVerify(inputs, makeCtx({ apply: true }))
      const text = JSON.stringify(detection)
      expect(text).not.toContain('SOCKET_RELEASE_APP_PRIVATE_KEY')
      expect(text).not.toContain('SOCKET_RELEASE_CLIENT_ID')
    }
  })
})
