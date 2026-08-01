/**
 * @file Pure planning core: canonical ordering + dedupe, the precondition
 *   DAG, resume selection, receipt currency, and next-command rendering.
 */

import { describe, expect, it } from 'vitest'

import {
  PRECONDITIONS,
  STEP_IDS,
  canonicalizeSteps,
  isReceiptCurrent,
  nextCommandFor,
  nextPendingStep,
  planRun,
  preconditionGaps,
} from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/plan.mts'
import type { StepReceipt } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/plan.mts'

const passed: StepReceipt = {
  at: '2026-07-31T00:00:00.000Z',
  dryRun: false,
  status: 'passed',
}

describe('canonicalizeSteps', () => {
  it('orders positional steps canonically and dedupes', () => {
    expect(
      canonicalizeSteps(['verify', 'preflight', 'verify', 'placeholder']),
    ).toEqual(['preflight', 'placeholder', 'verify'])
  })

  it('throws on an unknown step naming the valid set', () => {
    expect(() => canonicalizeSteps(['deploy'])).toThrowError(
      new RegExp(STEP_IDS.join(', ').replaceAll('-', '\\-')),
    )
  })

  it('accepts the amendment access steps', () => {
    expect(
      canonicalizeSteps(['npm-access-staged-only', 'npm-access-permissive']),
    ).toEqual(['npm-access-permissive', 'npm-access-staged-only'])
  })
})

describe('preconditionGaps', () => {
  it('names the missing steps for a fresh trusted-publisher run', () => {
    const gaps = preconditionGaps(['trusted-publisher'], {})
    expect(gaps).toEqual([
      {
        missing: ['placeholder', 'github-env', 'staged-config'],
        step: 'trusted-publisher',
      },
    ])
  })

  it('is satisfied by passed receipts', () => {
    const gaps = preconditionGaps(['trusted-publisher'], {
      'github-env': passed,
      placeholder: passed,
      'staged-config': passed,
    })
    expect(gaps).toEqual([])
  })

  it('is satisfied by steps scheduled earlier in the same run', () => {
    const gaps = preconditionGaps(
      [
        'preflight',
        'placeholder',
        'github-env',
        'staged-config',
        'trusted-publisher',
      ],
      {},
    )
    expect(gaps).toEqual([])
  })

  it('blocked and failed receipts never satisfy a precondition', () => {
    for (const status of ['blocked', 'failed', 'planned'] as const) {
      const gaps = preconditionGaps(['placeholder'], {
        preflight: { ...passed, status },
      })
      expect(gaps).toHaveLength(1)
      expect(gaps[0]!.missing).toEqual(['preflight'])
    }
  })

  it('gates the tighten step on placeholder + trusted-publisher', () => {
    expect(PRECONDITIONS['npm-access-staged-only']).toEqual([
      'placeholder',
      'trusted-publisher',
    ])
    const gaps = preconditionGaps(['npm-access-staged-only'], {
      placeholder: passed,
    })
    expect(gaps[0]!.missing).toEqual(['trusted-publisher'])
  })
})

describe('planRun (resume)', () => {
  it('with no positionals runs every step lacking a passed receipt', () => {
    expect(planRun([], { preflight: passed })).toEqual(
      STEP_IDS.filter(s => s !== 'preflight'),
    )
  })

  it('all-passed resumes to verify only', () => {
    const receipts = Object.fromEntries(STEP_IDS.map(s => [s, passed]))
    expect(planRun([], receipts)).toEqual(['verify'])
  })

  it('explicit positionals run exactly those steps', () => {
    expect(planRun(['verify'], {})).toEqual(['verify'])
  })
})

describe('isReceiptCurrent / nextPendingStep / nextCommandFor', () => {
  it('only passed receipts are current', () => {
    expect(isReceiptCurrent(passed)).toBe(true)
    expect(isReceiptCurrent(undefined)).toBe(false)
    expect(isReceiptCurrent({ ...passed, status: 'blocked' })).toBe(false)
  })

  it('nextPendingStep walks canonical order', () => {
    expect(nextPendingStep({ preflight: passed })).toBe('placeholder')
    expect(
      nextPendingStep(Object.fromEntries(STEP_IDS.map(s => [s, passed]))),
    ).toBeUndefined()
  })

  it('nextCommandFor carries --reserve only for placeholder', () => {
    expect(nextCommandFor('placeholder', { packageName: '@x/y' })).toBe(
      'node scripts/socket-release/bootstrap.mts placeholder --apply --reserve @x/y',
    )
    expect(nextCommandFor('github-env', { packageName: '@x/y' })).toBe(
      'node scripts/socket-release/bootstrap.mts github-env --apply',
    )
  })
})
