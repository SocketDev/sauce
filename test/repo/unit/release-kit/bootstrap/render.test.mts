/**
 * @file Rendering + the hand-rolled document validator: every committed run
 *   golden validates clean; six mutated documents are rejected each naming
 *   its violation; formatKitError carries the four ingredients in order;
 *   the status table renders all eight steps.
 */

import { describe, expect, it } from 'vitest'

import {
  KitError,
  formatKitError,
  gateToJson,
  renderStatusTable,
  renderStepHuman,
  validateRunJson,
} from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import type { RunJson } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import { STEP_IDS } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/plan.mts'
import { reserveNameGate } from '../../../../../release-kit/payload/scripts/socket-release/_shared/human-gate.mts'
import { fixture } from '../helpers.mts'

const GOLDENS = [
  'run-plan',
  'run-blocked',
  'run-reserve-gate',
  'run-status',
] as const

function golden(name: string): RunJson {
  return JSON.parse(fixture(`run/${name}.golden.json`)) as RunJson
}

describe('validateRunJson', () => {
  it('accepts every committed golden', () => {
    for (const name of GOLDENS) {
      expect(validateRunJson(golden(name)), name).toEqual([])
    }
  })

  it('rejects six mutated documents, each naming its violation', () => {
    const base = () => golden('run-plan')

    const noSteps = base() as Record<string, unknown>
    delete noSteps['steps']
    expect(validateRunJson(noSteps).join(' ')).toContain(
      'steps must be an array',
    )

    const badStatus = base()
    ;(badStatus.steps[0] as { status: string }).status = 'maybe'
    expect(validateRunJson(badStatus).join(' ')).toContain(
      'status must be one of',
    )

    const badExit = base() as { exitCode: unknown }
    badExit.exitCode = 1.5
    expect(validateRunJson(badExit).join(' ')).toContain(
      'exitCode must be an integer',
    )

    const badSchema = base() as { schemaVersion: unknown }
    badSchema.schemaVersion = 2
    expect(validateRunJson(badSchema).join(' ')).toContain(
      'schemaVersion must be 1',
    )

    const badGate = base()
    ;(badGate.steps[1] as { gate: unknown }).gate = { name: 42 }
    expect(validateRunJson(badGate).join(' ')).toContain('gate must be null or')

    const badCheck = base()
    ;(badCheck.steps[0]!.checks[0] as { ok: unknown }).ok = 'yes'
    expect(validateRunJson(badCheck).join(' ')).toContain('checks[0]')
  })

  it('rejects a non-object outright', () => {
    expect(validateRunJson('nope')).toEqual(['document is not an object'])
  })
})

describe('formatKitError', () => {
  it('carries the four ingredients in order as machine fields', () => {
    const err = new KitError(
      {
        fix: 'do the one thing.',
        saw: 'the wrong thing',
        wanted: 'the right thing',
        what: 'Something failed.',
        where: '/x/y',
      },
      1,
    )
    expect(err.fields).toEqual({
      fix: 'do the one thing.',
      saw: 'the wrong thing',
      wanted: 'the right thing',
      what: 'Something failed.',
      where: '/x/y',
    })
    expect(err.exitCode).toBe(1)
    const lines = formatKitError(err.fields).split('\n')
    expect(lines[0]).toBe('Something failed.')
    expect(lines[1]!.startsWith('  Where: ')).toBe(true)
    expect(lines[2]!.startsWith('  Saw: ')).toBe(true)
    expect(lines[3]!.startsWith('  Wanted: ')).toBe(true)
    expect(lines[4]!.startsWith('  Fix: ')).toBe(true)
  })
})

describe('renderStatusTable / renderStepHuman / gateToJson', () => {
  it('the status table renders all eight steps', () => {
    const table = renderStatusTable({})
    expect(table).toHaveLength(STEP_IDS.length)
    for (const id of STEP_IDS) {
      expect(table.some(l => l.startsWith(id))).toBe(true)
    }
  })

  it('gateToJson carries the factory-rendered lines', () => {
    const gate = gateToJson(reserveNameGate('@x/y', 'restricted', 'resumes.'))
    expect(gate.name).toBe('reserve name')
    expect(gate.lines[0]).toContain('HUMAN GATE — reserve name')
  })

  it('renderStepHuman marks passed/planned/failed distinctly', () => {
    const outcome = golden('run-plan').steps[0]!
    const lines = renderStepHuman(outcome)
    expect(lines[0]).toContain('preflight: passed (already)')
  })
})
