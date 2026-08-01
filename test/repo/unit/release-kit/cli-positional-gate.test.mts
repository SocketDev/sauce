/**
 * @file The registry-writing entries must refuse a dash-less mode typo. The
 *   kit's parseArgs (allowPositionals:false, strict:false) folds a bare token
 *   like `approve` into positionals without throwing, so without a gate
 *   cargo-publish.mts falls through to its default --staged path and
 *   create-release.mts cuts a real GitHub release. Each entry exits 2 (the
 *   usage-error code) with the shared Fix line instead.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const SOCKET_RELEASE_DIR = path.join(
  REPO_ROOT,
  'release-kit',
  'payload',
  'scripts',
  'socket-release',
)

function runEntry(
  script: string,
  args: readonly string[],
): { status: number | null; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [path.join(SOCKET_RELEASE_DIR, script), ...args],
    { encoding: 'utf8', timeout: 60_000 },
  )
  return { status: result.status, stderr: result.stderr }
}

describe('cargo-publish.mts stray-positional gate', () => {
  it('exits 2 on a dash-less mode typo instead of falling through to --staged', () => {
    const { status, stderr } = runEntry('cargo-publish.mts', ['approve'])
    expect(status).toBe(2)
    expect(stderr).toContain('Unexpected argument: approve.')
    expect(stderr).toContain('did you drop a leading --?')
  })
})

describe('create-release.mts stray-positional gate', () => {
  it('exits 2 on a stray positional instead of cutting a release', () => {
    const { status, stderr } = runEntry('create-release.mts', ['release'])
    expect(status).toBe(2)
    expect(stderr).toContain('Unexpected argument: release.')
    expect(stderr).toContain('did you drop a leading --?')
  })
})
