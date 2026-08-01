/**
 * @file State-file receipts: round-trip, schemaVersion refusal, contextKey
 *   invalidation, and the corrupted-JSON refusal (never silently fresh).
 *   Assertions target the machine fields (KitError.fields / exitCode).
 */

import { describe, expect, it } from 'vitest'

import {
  contextKey,
  freshState,
  parseState,
  serializeState,
  withReceipt,
} from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/state.mts'
import { KitError } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'

const KEY = contextKey('SocketDev/example', '@socketsecurity/example')

function fresh() {
  return freshState({
    expectedKey: KEY,
    packageName: '@socketsecurity/example',
    packageVersion: '1.0.0',
    root: '/tmp/example-repo',
    slug: 'SocketDev/example',
  })
}

describe('state round-trip', () => {
  it('parse(serialize(state)) preserves receipts and context', () => {
    const state = withReceipt(fresh(), 'preflight', {
      at: '2026-07-31T00:00:00.000Z',
      dryRun: false,
      status: 'passed',
    })
    const back = parseState(serializeState(state), KEY, '/x/state.json')
    expect(back).toEqual(state)
  })

  it('withReceipt is pure — the original state is untouched', () => {
    const state = fresh()
    withReceipt(state, 'verify', {
      at: 'x',
      dryRun: false,
      status: 'failed',
    })
    expect(state.receipts).toEqual({})
  })

  it('contextKey is deterministic and slug+name sensitive', () => {
    expect(contextKey('a/b', 'p')).toBe(contextKey('a/b', 'p'))
    expect(contextKey('a/b', 'p')).not.toBe(contextKey('a/b', 'q'))
  })
})

describe('state refusals', () => {
  it('foreign schemaVersion refuses with usage exit code', () => {
    const doc = { ...fresh(), schemaVersion: 2 }
    try {
      parseState(JSON.stringify(doc), KEY, '/x/state.json')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(KitError)
      expect((e as KitError).exitCode).toBe(2)
      expect((e as KitError).fields.saw).toContain('2')
    }
  })

  it('a changed context invalidates every receipt with Fix: --reset', () => {
    const otherKey = contextKey('SocketDev/other', '@socketsecurity/example')
    try {
      parseState(serializeState(fresh()), otherKey, '/x/state.json')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(KitError)
      expect((e as KitError).exitCode).toBe(2)
      expect((e as KitError).fields.fix).toContain('--reset')
    }
  })

  it('corrupted JSON refuses — never silently reads as fresh state', () => {
    try {
      parseState('{ definitely not json', KEY, '/x/state.json')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(KitError)
      expect((e as KitError).exitCode).toBe(2)
      expect((e as KitError).fields.fix).toContain('--reset')
    }
  })
})
