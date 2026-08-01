/**
 * @file The pure install planner: copy / skip-identical / conflict
 *   classification, the idempotent empty second plan, and missing-target
 *   classification. The planner never touches fs — inputs are maps.
 */

import { describe, expect, it } from 'vitest'

import { planInstall } from '../../../../../release-kit/install/plan.mts'
import type { ManifestEntry } from '../../../../../release-kit/install/manifest.mts'

const entries: ManifestEntry[] = [
  { channels: ['common'], path: 'bootstrap.mts', sha256: 'a'.repeat(64) },
  { channels: ['npm'], path: 'npm-publish.mts', sha256: 'b'.repeat(64) },
  {
    channels: ['npm'],
    path: 'publish-infra/npm/shared.mts',
    sha256: 'c'.repeat(64),
  },
]

describe('planInstall', () => {
  it('classifies copy / identical / conflict', () => {
    const plan = planInstall({
      entries,
      targetReads: new Map([
        ['bootstrap.mts', undefined],
        ['npm-publish.mts', 'b'.repeat(64)],
        ['publish-infra/npm/shared.mts', 'f'.repeat(64)],
      ]),
    })
    expect(plan.copies.map(f => f.path)).toEqual(['bootstrap.mts'])
    expect(plan.identical.map(f => f.path)).toEqual(['npm-publish.mts'])
    expect(plan.conflicts).toEqual([
      {
        action: 'conflict',
        path: 'publish-infra/npm/shared.mts',
        sawSha256: 'f'.repeat(64),
        sha256: 'c'.repeat(64),
      },
    ])
  })

  it('a missing target read classifies every file as copy', () => {
    const plan = planInstall({ entries, targetReads: new Map() })
    expect(plan.copies).toHaveLength(3)
    expect(plan.conflicts).toEqual([])
  })

  it('an identical target plans an EMPTY second install', () => {
    const plan = planInstall({
      entries,
      targetReads: new Map(entries.map(e => [e.path, e.sha256])),
    })
    expect(plan.copies).toEqual([])
    expect(plan.conflicts).toEqual([])
    expect(plan.identical).toHaveLength(3)
  })
})
