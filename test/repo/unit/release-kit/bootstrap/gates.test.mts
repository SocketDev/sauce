/**
 * @file Mirror test over CANONICAL_GATES: every gate any kit flow can render
 *   comes from a factory and holds the 6-line fleet shape. SANCTIONED SHAPE
 *   EXCEPTION: these assertions pin gate line PREFIXES (the fleet gate
 *   format is itself the contract) — one of the two allowed prose-shaped
 *   assertions.
 */

import { describe, expect, it } from 'vitest'

import {
  formatHumanGate,
  formatHumanGateQueue,
} from '../../../../../release-kit/payload/scripts/socket-release/_shared/human-gate.mts'
import { CANONICAL_GATES } from '../../../../../release-kit/payload/scripts/socket-release/bootstrap/gates.mts'

describe('CANONICAL_GATES mirror', () => {
  it('carries all eight factories exactly once', () => {
    expect(CANONICAL_GATES.map(g => g.id).toSorted()).toEqual([
      'browser-session',
      'gh-env',
      'npm-auth',
      'placeholder-promote',
      'publish-approve',
      'push-grant',
      'reserve-name',
      'web-auth-approve',
    ])
  })

  for (const { gate, id } of CANONICAL_GATES) {
    it(`${id} renders the 6-line fleet shape`, () => {
      const lines = formatHumanGate(gate, { index: 1, total: 1 })
      expect(lines[0]).toMatch(/^🖐 {2}HUMAN GATE — .+ \[1\/1\]$/)
      expect(lines[1]!.startsWith('  Need: ')).toBe(true)
      // Mind is optional; when present it sits between Need and A) You.
      const aIdx = lines.findIndex(l => l.startsWith('  A) You: '))
      expect(aIdx).toBeGreaterThanOrEqual(2)
      if (aIdx === 3) {
        expect(lines[2]!.startsWith('  Mind: ')).toBe(true)
      }
      expect(lines[aIdx + 1]!.startsWith('  B) Me: ')).toBe(true)
      expect(lines.at(-1)!.startsWith('  Then: ')).toBe(true)
    })
  }

  it('queues number every gate [i/N] in clearing order', () => {
    const lines = formatHumanGateQueue(CANONICAL_GATES.map(g => g.gate))
    const headers = lines.filter(l => l.startsWith('🖐'))
    expect(headers).toHaveLength(CANONICAL_GATES.length)
    for (let i = 0; i < headers.length; i += 1) {
      expect(headers[i]).toContain(`[${i + 1}/${CANONICAL_GATES.length}]`)
    }
  })

  it('never names an org secret as missing human work', () => {
    for (const { gate } of CANONICAL_GATES) {
      const text = formatHumanGate(gate).join('\n')
      expect(text).not.toContain('SOCKET_RELEASE_APP_PRIVATE_KEY')
      expect(text).not.toContain('SOCKET_RELEASE_CLIENT_ID')
    }
  })
})
