/**
 * @file The spawn seams must degrade to a non-zero exit code when a binary is
 *   absent (ENOENT) rather than rejecting the promise — every `.code`-checking
 *   caller (preflight's gh/git red-checks, the publish legs' pnpm pack) then
 *   surfaces its designed refusal instead of an unhandled-rejection stack.
 */

import { describe, expect, it } from 'vitest'

import { resolveSeams } from '../../../../release-kit/payload/scripts/socket-release/bootstrap/seams.mts'
import { runCapture } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/shared.mts'

const MISSING = 'socket-release-nonexistent-binary-xyzzy'

describe('spawn seams on a missing binary (ENOENT)', () => {
  it('bootstrap seams.exec resolves a non-zero code instead of rejecting', async () => {
    const result = await resolveSeams().exec(
      MISSING,
      ['--version'],
      process.cwd(),
    )
    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
  })

  it('publish-infra runCapture resolves a non-zero code instead of rejecting', async () => {
    const result = await runCapture(MISSING, ['--version'], process.cwd())
    expect(result.code).not.toBe(0)
  })
})
