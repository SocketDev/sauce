/**
 * @file Pure parser for the npm package settings "Publishing access" block —
 *   the pair of toggles that decide whether a package accepts DIRECT
 *   publishes (`npm publish` straight to a public version) and STAGED
 *   publishes (`npm publish --staged` / trusted-publishing OIDC). No
 *   playwright, no network: the browser side (`access-page.mts`) reads the
 *   signed-in `/package/<pkg>/access` page and feeds the raw HTML here, the
 *   same split as `trusted-publisher-parse.mts`. The markers mirror npm's
 *   form wire contract (checkbox `name="allowDirectPublish"` /
 *   `name="allowStagedPublish"`, with the React initial-data JSON keys
 *   `directPublishEnabled` / `stagedPublishEnabled` as the fallback), the
 *   contract the trusted-publisher checkboxes (`allowPublish` /
 *   `allowStagePublish`) already proved stabler than DOM structure.
 *   An unreadable page NEVER defaults: `state: 'unknown'` is a refusal the
 *   callers must surface, not a classification — misreading "unknown" as
 *   "staged-only" would let a bootstrap re-run skip the tighten step, and
 *   misreading it as "both-enabled" would re-plan a write against a page the
 *   parser cannot see.
 */

/**
 * The four readable answers for a package's publishing-access settings.
 * `unknown` means the page did not carry the block in any recognized shape —
 * a refusal, never a default.
 */
export type PublishingAccessState =
  | 'both-enabled'
  | 'direct-only'
  | 'staged-only'
  | 'unknown'

/**
 * One publishing-access read: the two raw toggle values (undefined when the
 * marker was absent) plus their classification.
 */
export interface PublishingAccessRead {
  directEnabled: boolean | undefined
  stagedEnabled: boolean | undefined
  state: PublishingAccessState
}

/**
 * Classify a pair of toggle reads. Either toggle unreadable → `unknown`
 * (refuse, never guess); both readable → the three real states, where
 * "neither enabled" also reads as `unknown` because npm's settings page
 * never renders that shape (a package must accept at least one publish
 * path). Pure — exported for tests.
 */
export function classifyPublishingAccess(
  directEnabled: boolean | undefined,
  stagedEnabled: boolean | undefined,
): PublishingAccessState {
  if (directEnabled === undefined || stagedEnabled === undefined) {
    return 'unknown'
  }
  if (directEnabled && stagedEnabled) {
    return 'both-enabled'
  }
  if (directEnabled) {
    return 'direct-only'
  }
  if (stagedEnabled) {
    return 'staged-only'
  }
  return 'unknown'
}

// One toggle off the page: the whole input tag whatever the attribute order,
// checkedness tested on the matched tag text (the trusted-publisher parser's
// proven pattern), else the React initial-data JSON key whose quotes may be
// escaped when the JSON is embedded in another string.
function readToggle(
  html: string,
  checkboxName: string,
  jsonKey: string,
): boolean | undefined {
  const tag = new RegExp(
    `<input[^>]*\\bname="${checkboxName}"[^>]*>`,
    'i',
  ).exec(html)
  if (tag) {
    return /\bchecked\b/i.test(tag[0])
  }
  const json = new RegExp(`\\\\?"${jsonKey}\\\\?"\\s*:\\s*(true|false)`).exec(
    html,
  )
  if (json) {
    return json[1] === 'true'
  }
  return undefined
}

/**
 * Parse the publishing-access block out of the signed-in access page. Both
 * toggles must be readable for a real classification; anything else is
 * `state: 'unknown'` and the caller refuses. Pure — exported for tests.
 */
export function parsePublishingAccess(html: string): PublishingAccessRead {
  const directEnabled = readToggle(
    html,
    'allowDirectPublish',
    'directPublishEnabled',
  )
  const stagedEnabled = readToggle(
    html,
    'allowStagedPublish',
    'stagedPublishEnabled',
  )
  return {
    directEnabled,
    stagedEnabled,
    state: classifyPublishingAccess(directEnabled, stagedEnabled),
  }
}
