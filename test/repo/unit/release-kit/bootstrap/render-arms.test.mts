/**
 * @file The validateRunJson error arms and the rich render paths not already
 *   pinned: an empty document tripping every top-level field, a malformed step
 *   tripping every per-step field, and renderStepHuman/renderStatusTable over
 *   failing checks, applied/would effects, gate lines, and dry-run receipts.
 */

import { describe, expect, it } from 'vitest'

import {
  renderStatusTable,
  renderStepHuman,
  validateRunJson,
} from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import type { StepOutcomeJson } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import type { StepReceipt } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/plan.mts'

describe('validateRunJson top-level arms', () => {
  it('an empty object trips every top-level field', () => {
    const errors = validateRunJson({ schemaVersion: 1 }).join(' | ')
    expect(errors).toContain('kit must be')
    expect(errors).toContain('mode must be')
    expect(errors).toContain('repo must carry')
    expect(errors).toContain('package must carry')
    expect(errors).toContain('requestedSteps must be')
    expect(errors).toContain('steps must be an array')
    expect(errors).toContain('state must carry')
    expect(errors).toContain('nextStep must be null')
    expect(errors).toContain('nextCommand must be null')
    expect(errors).toContain('exitCode must be an integer')
  })

  it('flags a non-object step entry', () => {
    expect(
      validateRunJson({ schemaVersion: 1, steps: ['x'] }).join(' '),
    ).toContain('steps[0] is not an object')
  })

  it('a malformed step object trips every per-step field', () => {
    const errors = validateRunJson({ schemaVersion: 1, steps: [{}] }).join(
      ' | ',
    )
    expect(errors).toContain('steps[0].step is not a step id')
    expect(errors).toContain('steps[0].status must be')
    expect(errors).toContain('steps[0].already must be a boolean')
    expect(errors).toContain('steps[0].detail must be a string')
    expect(errors).toContain('steps[0].durationMs must be an integer')
    expect(errors).toContain('steps[0].checks must be an array')
    expect(errors).toContain('steps[0].effects must be an array')
    expect(errors).toContain('steps[0].gate must be null or')
  })

  it('flags malformed check and effect entries', () => {
    const errors = validateRunJson({
      schemaVersion: 1,
      steps: [{ checks: [{}], effects: [{}], gate: null }],
    }).join(' | ')
    expect(errors).toContain('steps[0].checks[0] must be')
    expect(errors).toContain('steps[0].effects[0] must be')
  })

  it('flags a malformed nextStep and nextCommand of the wrong type', () => {
    const errors = validateRunJson({
      nextCommand: 5,
      nextStep: 'not-a-step',
      schemaVersion: 1,
    }).join(' | ')
    expect(errors).toContain('nextStep must be null')
    expect(errors).toContain('nextCommand must be null')
  })
})

describe('renderStepHuman rich output', () => {
  it('renders the failed mark, failing check with fix, effects, and gate lines', () => {
    const outcome: StepOutcomeJson = {
      already: true,
      checks: [
        { fix: 'do z', id: 'c1', ok: false, saw: 'x', wanted: 'y' },
        { fix: null, id: 'c2', ok: true, saw: '', wanted: '' },
      ],
      detail: 'boom',
      effects: [
        { applied: true, description: 'published', kind: 'registry-publish' },
        { applied: false, description: 'would tag', kind: 'git-tag' },
      ],
      gate: { lines: ['GATE line 1', 'GATE line 2'], name: 'human-gate' },
      status: 'failed',
      step: 'preflight',
    }
    const lines = renderStepHuman(outcome)
    expect(lines[0]).toContain('× preflight: failed (already) — boom')
    expect(lines.some(l => l.includes('× c1: saw x; wanted y'))).toBe(true)
    expect(lines.some(l => l.includes('Fix: do z'))).toBe(true)
    expect(
      lines.some(l => l.includes('did [registry-publish] published')),
    ).toBe(true)
    expect(lines.some(l => l.includes('would [git-tag] would tag'))).toBe(true)
    expect(lines).toContain('GATE line 1')
    expect(lines.some(l => l.includes('c2'))).toBe(false)
  })

  it('renders the neutral mark for a skipped step', () => {
    const outcome: StepOutcomeJson = {
      already: false,
      checks: [],
      detail: 'nothing to do',
      effects: [],
      gate: null,
      status: 'skipped',
      step: 'placeholder',
    }
    expect(renderStepHuman(outcome)[0]!.startsWith('·')).toBe(true)
  })
})

describe('renderStatusTable', () => {
  it('renders a dry-run receipt with its timestamp and pending for the rest', () => {
    const receipts: Partial<Record<string, StepReceipt>> = {
      preflight: {
        at: '2026-07-31T00:00:00.000Z',
        dryRun: true,
        status: 'passed',
      } as StepReceipt,
    }
    const table = renderStatusTable(receipts as Record<never, StepReceipt>)
    expect(
      table.some(
        l => l.includes('passed (dry-run)') && l.includes('at 2026-07-31'),
      ),
    ).toBe(true)
    expect(table.some(l => l.includes('pending'))).toBe(true)
  })
})
