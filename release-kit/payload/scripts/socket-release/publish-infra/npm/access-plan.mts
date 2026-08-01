/**
 * @file Pure planning for the publishing-access toggles: the two desired
 *   shapes the bootstrap drives a package through, and the diff/verify
 *   helpers between a read and a desired shape. The ORDER these shapes are
 *   applied in is the bootstrap's law — PERMISSIVE first (so the one-time
 *   direct 0.0.0 placeholder publish can land), STAGED-ONLY after (so from
 *   then on only staged/trusted publishing is possible) — and re-running the
 *   bootstrap never re-widens: the permissive shape is planned ONLY while
 *   the placeholder publish is still pending (see
 *   `bootstrap/steps/npm-access-permissive.mts`). No I/O here; the browser
 *   drive lives in `access-page.mts` and behind the bootstrap seams.
 */

import type { PublishingAccessRead } from './access-parse.mts'

/**
 * A desired publishing-access shape: both toggles, stated explicitly.
 */
export interface PublishingAccessDesired {
  directEnabled: boolean
  stagedEnabled: boolean
}

/**
 * The wide shape: BOTH direct and staged publishing permitted — required
 * only while the direct 0.0.0 placeholder publish has yet to land.
 */
export const PERMISSIVE_ACCESS: PublishingAccessDesired = {
  directEnabled: true,
  stagedEnabled: true,
}

/**
 * The terminal shape: staged/trusted publishing ONLY, direct publishing
 * disabled. Every bootstrapped package must end here.
 */
export const STAGED_ONLY_ACCESS: PublishingAccessDesired = {
  directEnabled: false,
  stagedEnabled: true,
}

/**
 * One checkbox edit the browser driver performs on the access page.
 */
export interface PublishingAccessEdit {
  checkbox: 'allowDirectPublish' | 'allowStagedPublish'
  to: boolean
}

/**
 * Whether a read already IS the desired shape — the idempotent no-op test.
 * An `unknown` read never matches (refuse, never assume done).
 */
export function accessMatchesDesired(
  read: PublishingAccessRead,
  desired: PublishingAccessDesired,
): boolean {
  return (
    read.state !== 'unknown' &&
    read.directEnabled === desired.directEnabled &&
    read.stagedEnabled === desired.stagedEnabled
  )
}

/**
 * The checkbox edits that take `read` to `desired`. Throws on an `unknown`
 * read: planning writes against a page the parser could not read is exactly
 * the misclassification this layer exists to refuse. Pure — exported for
 * tests.
 */
export function diffPublishingAccess(
  read: PublishingAccessRead,
  desired: PublishingAccessDesired,
): PublishingAccessEdit[] {
  if (read.state === 'unknown') {
    throw new Error(
      'Refusing to plan publishing-access edits: the access page read is unknown.\n' +
        '  Where: the publishing-access block of the package access page\n' +
        '  Saw: a page without readable allowDirectPublish/allowStagedPublish toggles\n' +
        '  Wanted: both toggles readable\n' +
        '  Fix: sign in to npm in the sanctioned browser session and re-run — an unreadable page is never a state.',
    )
  }
  const edits: PublishingAccessEdit[] = []
  if (read.directEnabled !== desired.directEnabled) {
    edits.push({ checkbox: 'allowDirectPublish', to: desired.directEnabled })
  }
  if (read.stagedEnabled !== desired.stagedEnabled) {
    edits.push({ checkbox: 'allowStagedPublish', to: desired.stagedEnabled })
  }
  return edits
}
