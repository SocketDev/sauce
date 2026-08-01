/**
 * @file Page-level playwright I/O for the publishing-access toggles — the
 *   package-settings block that decides whether DIRECT and/or STAGED
 *   publishes are accepted. Same split as the trusted-publisher driver: the
 *   signed-in access-page read feeds the pure parser
 *   (`access-parse.mts`), the drive fills the two checkboxes and clicks
 *   Save, and the post-save verify RE-READS until the page itself reports
 *   the desired shape — success is the page's answer, never the click. The
 *   session comes from the ONE sanctioned launch site
 *   (`browser-session.mts`), and the bootstrap reaches this module only
 *   through its seams so every test drives a fake.
 */

import type { Page } from 'playwright-core'

import { optIntoChallengeCooldown, sleep } from './browser-session.mts'
import { parsePublishingAccess } from './access-parse.mts'
import type { PublishingAccessRead } from './access-parse.mts'
import { accessMatchesDesired, diffPublishingAccess } from './access-plan.mts'
import type { PublishingAccessDesired } from './access-plan.mts'
import { accessUrl } from './trusted-publisher-page.mts'
import { classifyAccessPage } from './trusted-publisher-parse.mts'

// Post-save verify budget: the operator may be answering a 2FA challenge in
// the window, so the re-read polls patiently rather than failing fast.
const SAVE_VERIFY_POLL_MS = 3000
const SAVE_VERIFY_TIMEOUT_MS = 3 * 60_000

// Fetch the access page HTML in the page's MAIN world (the page's cookies
// authenticate it; cache no-store so a post-save re-read never sees stale
// pre-mutation HTML).
async function fetchAccessPage(
  page: Page,
  pkg: string,
): Promise<{ body: string; status: number }> {
  try {
    return await page.evaluate(async fetchUrl => {
      // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- runs in the npm page's MAIN world via page.evaluate; only the page's cookies authenticate this request.
      const r = await fetch(fetchUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'text/html' },
        method: 'GET',
      })
      return { body: await r.text(), status: r.status }
    }, accessUrl(pkg))
  } catch {
    return { body: '', status: 0 }
  }
}

/**
 * Read one package's publishing-access toggles off the signed-in access
 * page. An auth/challenge/error page reads as `state: 'unknown'` — the
 * refusal shape the pure layer defines, never a default classification.
 */
export async function readPublishingAccessInPage(
  page: Page,
  pkg: string,
): Promise<PublishingAccessRead> {
  const { body, status } = await fetchAccessPage(page, pkg)
  const pageState = classifyAccessPage({ body, status })
  if (
    pageState === 'auth' ||
    pageState === 'challenge' ||
    pageState === 'error'
  ) {
    return {
      directEnabled: undefined,
      stagedEnabled: undefined,
      state: 'unknown',
    }
  }
  return parsePublishingAccess(body)
}

/**
 * Drive the publishing-access checkboxes to `desired`, click Save, then poll
 * the RE-READ until the page reports the desired shape or the budget
 * elapses. Returns the final read plus whether it matched — the caller
 * treats a non-match as saved-state-unproven, never as success.
 */
export async function drivePublishingAccess(
  page: Page,
  pkg: string,
  desired: PublishingAccessDesired,
): Promise<{ ok: boolean; read: PublishingAccessRead }> {
  await page.goto(accessUrl(pkg), { waitUntil: 'domcontentloaded' })
  await optIntoChallengeCooldown(page)
  const before = await readPublishingAccessInPage(page, pkg)
  // diffPublishingAccess throws on an unknown read — refuse, never drive
  // blind edits against a page the parser could not read.
  const edits = diffPublishingAccess(before, desired)
  for (let i = 0, { length } = edits; i < length; i += 1) {
    const edit = edits[i]!
    const box = page.locator(`input[name="${edit.checkbox}"]`).first()
    // eslint-disable-next-line no-await-in-loop -- serial form drive on one live page.
    await box.setChecked(edit.to, { timeout: 10_000 })
  }
  if (edits.length > 0) {
    const save = page
      .getByRole('button', { name: /save changes|save|update/i })
      .first()
    await save.click({ timeout: 10_000 })
  }
  const deadline = Date.now() + SAVE_VERIFY_TIMEOUT_MS
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- serial poll while npm settles/2FA completes.
    await optIntoChallengeCooldown(page)
    // eslint-disable-next-line no-await-in-loop -- serial poll while npm settles/2FA completes.
    const read = await readPublishingAccessInPage(page, pkg)
    if (accessMatchesDesired(read, desired)) {
      return { ok: true, read }
    }
    if (Date.now() >= deadline) {
      return { ok: false, read }
    }
    // eslint-disable-next-line no-await-in-loop -- serial poll interval.
    await sleep(SAVE_VERIFY_POLL_MS)
  }
}
