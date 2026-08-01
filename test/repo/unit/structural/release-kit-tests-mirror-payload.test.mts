// socket-lint: mirror-exempt — enforces naming law rule 8 across the whole release-kit test tree, so the tree is the subject, not a module.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const TEST_ROOT = path.join(REPO_ROOT, 'test', 'repo', 'unit', 'release-kit')
const PAYLOAD_ROOT = path.join(
  REPO_ROOT,
  'release-kit',
  'payload',
  'scripts',
  'socket-release',
)

const NON_MIRROR_DIRS = new Set(['fixtures', 'fuzz', 'install', 'lib'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else {
      out.push(full)
    }
  }
  return out
}

function payloadModulesByBasename(): Map<string, string[]> {
  const byBase = new Map<string, string[]>()
  for (const file of walk(PAYLOAD_ROOT)) {
    if (!file.endsWith('.mts') && !file.endsWith('.mjs')) {
      continue
    }
    const rel = path.relative(PAYLOAD_ROOT, file).replace(/\.(?:mts|mjs)$/, '')
    const base = path.basename(rel)
    const bucket = byBase.get(base) ?? []
    bucket.push(rel)
    byBase.set(base, bucket)
  }
  return byBase
}

describe('naming law rule 8: release-kit tests mirror the payload path', () => {
  it('no module test drops a payload directory segment from its path', () => {
    const byBase = payloadModulesByBasename()
    const misfiled: string[] = []
    for (const file of walk(TEST_ROOT)) {
      if (!file.endsWith('.test.mts')) {
        continue
      }
      const relFromTestRoot = path.relative(TEST_ROOT, file)
      const topSegment = relFromTestRoot.split(path.sep)[0]!
      if (NON_MIRROR_DIRS.has(topSegment)) {
        continue
      }
      const subjectRel = relFromTestRoot.replace(/\.test\.mts$/, '')
      if (
        existsSync(path.join(PAYLOAD_ROOT, `${subjectRel}.mts`)) ||
        existsSync(path.join(PAYLOAD_ROOT, `${subjectRel}.mjs`))
      ) {
        continue
      }
      const deeper = byBase.get(path.basename(subjectRel))
      if (deeper && deeper.length > 0) {
        misfiled.push(
          `${relFromTestRoot} — the module lives at ${deeper.join(' / ')}; ` +
            `file the test at test/repo/unit/release-kit/${deeper[0]}.test.mts`,
        )
      }
    }
    expect(
      misfiled,
      `${misfiled.length} release-kit test(s) drop a payload directory segment (rule 8):\n` +
        misfiled.map(entry => `  - ${entry}`).join('\n'),
    ).toEqual([])
  })
})
