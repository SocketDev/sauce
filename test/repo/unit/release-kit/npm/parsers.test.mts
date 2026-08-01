/**
 * @file Branch-exhaustive unit coverage for the three pure npm page parsers:
 *   the publishing-access toggles, the trusted-publisher summary, and the
 *   staged-tarball passback. Every classification arm, every JSON fallback,
 *   and every refusal is pinned here; the fuzz suite proves robustness on top.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyPublishingAccess,
  parsePublishingAccess,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-parse.mts'
import {
  allowsAction,
  classifyAccessPage,
  extractAllowedActions,
  parseTrustedPublisherForm,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/trusted-publisher-parse.mts'
import {
  classifyStagedFetch,
  isCloudflareChallenge,
  looksLikeHtmlBody,
  mapStagedTarball,
  parseStagedPayload,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/staged-browser-parse.mts'

describe('classifyPublishingAccess', () => {
  it('maps every readable pair and refuses on either unreadable toggle', () => {
    expect(classifyPublishingAccess(true, true)).toBe('both-enabled')
    expect(classifyPublishingAccess(true, false)).toBe('direct-only')
    expect(classifyPublishingAccess(false, true)).toBe('staged-only')
    expect(classifyPublishingAccess(false, false)).toBe('unknown')
    expect(classifyPublishingAccess(undefined, true)).toBe('unknown')
    expect(classifyPublishingAccess(true, undefined)).toBe('unknown')
    expect(classifyPublishingAccess(undefined, undefined)).toBe('unknown')
  })
})

describe('parsePublishingAccess', () => {
  it('reads checked checkboxes regardless of attribute order', () => {
    const html =
      '<input type="checkbox" checked name="allowDirectPublish" data-x>\n' +
      '<input name="allowStagedPublish" type="checkbox">'
    const read = parsePublishingAccess(html)
    expect(read.directEnabled).toBe(true)
    expect(read.stagedEnabled).toBe(false)
    expect(read.state).toBe('direct-only')
  })

  it('falls back to plain and escaped React JSON keys when no checkbox tag', () => {
    const plain = parsePublishingAccess(
      '"directPublishEnabled": true, "stagedPublishEnabled": false',
    )
    expect(plain.directEnabled).toBe(true)
    expect(plain.stagedEnabled).toBe(false)
    const escaped = parsePublishingAccess(
      '\\"directPublishEnabled\\": false, \\"stagedPublishEnabled\\": true',
    )
    expect(escaped.directEnabled).toBe(false)
    expect(escaped.stagedEnabled).toBe(true)
    expect(escaped.state).toBe('staged-only')
  })

  it('reads unknown when neither a checkbox nor a JSON key is present', () => {
    const read = parsePublishingAccess(
      '<html><body>no access block</body></html>',
    )
    expect(read.directEnabled).toBeUndefined()
    expect(read.stagedEnabled).toBeUndefined()
    expect(read.state).toBe('unknown')
  })
})

describe('classifyAccessPage', () => {
  it('a challenge body wins over any status', () => {
    expect(classifyAccessPage({ body: 'Just a moment...', status: 200 })).toBe(
      'challenge',
    )
    expect(
      classifyAccessPage({ body: 'cdn-cgi/challenge-platform/', status: 503 }),
    ).toBe('challenge')
  })

  it('401/403 or a signed-out page reads as auth', () => {
    expect(classifyAccessPage({ body: '', status: 401 })).toBe('auth')
    expect(classifyAccessPage({ body: '', status: 403 })).toBe('auth')
    expect(
      classifyAccessPage({ body: 'Please sign in to npm', status: 200 }),
    ).toBe('auth')
  })

  it('a sign-in page that also mentions Trusted Publishing is not auth', () => {
    expect(
      classifyAccessPage({
        body: 'sign in to npm — Trusted Publishing',
        status: 200,
      }),
    ).not.toBe('auth')
  })

  it('non-2xx statuses outside 401/403 are errors', () => {
    expect(classifyAccessPage({ body: '', status: 500 })).toBe('error')
    expect(classifyAccessPage({ body: '', status: 100 })).toBe('error')
  })

  it('configured pages via marker or JSON keys', () => {
    expect(
      classifyAccessPage({
        body: '<div id="github-repoInfo">o/r</div>',
        status: 200,
      }),
    ).toBe('configured')
    expect(
      classifyAccessPage({ body: '"trustedPublisher":{}', status: 200 }),
    ).toBe('configured')
    expect(
      classifyAccessPage({
        body: '\\"trustedPublisherConfigured\\":true',
        status: 200,
      }),
    ).toBe('configured')
  })

  it('unconfigured shells via any of the three access-page markers', () => {
    expect(classifyAccessPage({ body: 'Trusted Publisher', status: 200 })).toBe(
      'unconfigured',
    )
    expect(classifyAccessPage({ body: 'Publishing access', status: 200 })).toBe(
      'unconfigured',
    )
    expect(
      classifyAccessPage({ body: 'window.publishingAccess = 1', status: 200 }),
    ).toBe('unconfigured')
  })

  it('a bare HTML body with no markers is unconfigured, a non-HTML body is an error', () => {
    expect(
      classifyAccessPage({ body: '<html><body>hi</body></html>', status: 200 }),
    ).toBe('unconfigured')
    expect(classifyAccessPage({ body: 'plain text', status: 200 })).toBe(
      'error',
    )
  })
})

describe('parseTrustedPublisherForm', () => {
  it('parses owner/name/workflow/environment off the configured summary', () => {
    const html = [
      '<span id="github-repoInfo">SocketDev/example</span>',
      '<span id="github-workflowName">npm-publish.yml</span>',
      '<span id="github-environmentName">npm-publish</span>',
    ].join('\n')
    const parsed = parseTrustedPublisherForm(html)
    expect(parsed).toEqual({
      allowedActions: [],
      environmentName: 'npm-publish',
      repositoryName: 'example',
      repositoryOwner: 'SocketDev',
      workflowFilename: 'npm-publish.yml',
    })
  })

  it('treats a repo with no slash as owner-only and an empty env as undefined', () => {
    const parsed = parseTrustedPublisherForm(
      '<span id="github-repoInfo">justowner</span><span id="github-environmentName">   </span>',
    )
    expect(parsed!.repositoryOwner).toBe('justowner')
    expect(parsed!.repositoryName).toBeUndefined()
    expect(parsed!.environmentName).toBeUndefined()
  })

  it('reads the environment name from the escaped React JSON fallback', () => {
    const parsed = parseTrustedPublisherForm(
      '<span id="github-workflowName">release.yml</span>\\"githubEnvironmentName\\":\\"prod\\"',
    )
    expect(parsed!.workflowFilename).toBe('release.yml')
    expect(parsed!.environmentName).toBe('prod')
  })

  it('returns undefined when neither the repo nor the workflow marker is present', () => {
    expect(
      parseTrustedPublisherForm('<html>nothing here</html>'),
    ).toBeUndefined()
  })
})

describe('extractAllowedActions / allowsAction', () => {
  it('reads permission chips out of the Permissions block only', () => {
    const html =
      'Permissions:</span><div><code>npm publish</code> <code>npm stage publish</code></div>' +
      '<div><code>npm publish</code></div>'
    const actions = extractAllowedActions(html)
    expect(actions).toContain('npm publish')
    expect(actions).toContain('npm stage publish')
  })

  it('reads checked publish/stage checkboxes', () => {
    const html =
      '<input name="allowPublish" checked><input name="allowStagePublish" checked>'
    const actions = extractAllowedActions(html)
    expect(actions).toEqual(
      expect.arrayContaining(['npm publish', 'npm stage publish']),
    )
  })

  it('ignores unchecked checkboxes and unrelated code tags', () => {
    const html = '<input name="allowPublish"><code>rm -rf</code>'
    expect(extractAllowedActions(html)).toEqual([])
  })

  it('distinguishes the plain publish action from stage publish', () => {
    expect(allowsAction(['npm publish'], 'publish')).toBe(true)
    expect(allowsAction(['npm publish'], 'stage-publish')).toBe(false)
    expect(allowsAction(['npm stage publish'], 'stage-publish')).toBe(true)
    expect(allowsAction(['npm stage publish'], 'publish')).toBe(false)
    expect(allowsAction([], 'publish')).toBe(false)
  })
})

describe('staged-browser-parse helpers', () => {
  it('detects each Cloudflare marker and rejects an empty body', () => {
    expect(isCloudflareChallenge('')).toBe(false)
    expect(isCloudflareChallenge('Just a moment')).toBe(true)
    expect(isCloudflareChallenge('cf-chl-bypass')).toBe(true)
    expect(isCloudflareChallenge('_cf_chl_opt')).toBe(true)
    expect(isCloudflareChallenge('challenges.cloudflare.com/turnstile')).toBe(
      true,
    )
    expect(
      isCloudflareChallenge('Checking if the site connection is secure'),
    ).toBe(true)
  })

  it('recognizes HTML documents and rejects JSON bodies', () => {
    expect(looksLikeHtmlBody('<!doctype html>')).toBe(true)
    expect(looksLikeHtmlBody('  <html>')).toBe(true)
    expect(looksLikeHtmlBody('<title>x</title>')).toBe(true)
    expect(looksLikeHtmlBody('{"ok":true}')).toBe(false)
  })

  it('classifies fetch outcomes by body then status', () => {
    expect(classifyStagedFetch({ body: 'Just a moment', status: 200 })).toBe(
      'challenge',
    )
    expect(classifyStagedFetch({ body: '<html>', status: 200 })).toBe(
      'challenge',
    )
    expect(classifyStagedFetch({ body: '{}', status: 401 })).toBe('auth')
    expect(classifyStagedFetch({ body: '{}', status: 403 })).toBe('auth')
    expect(classifyStagedFetch({ body: '{}', status: 500 })).toBe('error')
    expect(classifyStagedFetch({ body: '{}', status: 200 })).toBe('ok')
    expect(classifyStagedFetch({ status: 200 })).toBe('ok')
  })
})

describe('mapStagedTarball / parseStagedPayload', () => {
  it('maps the primary field names', () => {
    const t = mapStagedTarball({
      dateStaged: '2026-07-31',
      packageName: '@scope/pkg',
      shasum: 'abc',
      stageId: 'stage-1',
      stagedBy: { tarballUrl: 'https://x/t.tgz' },
      tag: 'latest',
      version: '1.0.0',
    })
    expect(t).toEqual({
      createdAt: '2026-07-31',
      id: 'stage-1',
      packageName: '@scope/pkg',
      shasum: 'abc',
      tag: 'latest',
      tarballUrl: 'https://x/t.tgz',
      version: '1.0.0',
    })
  })

  it('falls back to the alternate field names', () => {
    const t = mapStagedTarball({
      created: '2026-01-01',
      id: 'id-2',
      name: 'plain',
      tarball: 'https://x/fallback.tgz',
      version: '2.0.0',
    })
    expect(t.createdAt).toBe('2026-01-01')
    expect(t.id).toBe('id-2')
    expect(t.packageName).toBe('plain')
    expect(t.tarballUrl).toBe('https://x/fallback.tgz')
  })

  it('defaults identity fields to empty strings for an empty record', () => {
    const t = mapStagedTarball({})
    expect(t.id).toBe('')
    expect(t.packageName).toBe('')
    expect(t.version).toBe('')
    expect(t.tarballUrl).toBeUndefined()
  })

  it('parses the full envelope and reads total from the payload number', () => {
    const body = JSON.stringify({
      approveURL: '/approve',
      csrftoken: 'tok',
      rejectURL: '/reject',
      stagedVersions: {
        objects: [{ packageName: 'a', stageId: 's1', version: '1.0.0' }],
        total: 7,
      },
    })
    const payload = parseStagedPayload(body)
    expect(payload.approveUrl).toBe('/approve')
    expect(payload.csrfToken).toBe('tok')
    expect(payload.rejectUrl).toBe('/reject')
    expect(payload.total).toBe(7)
    expect(payload.tarballs).toHaveLength(1)
  })

  it('falls back total to the object count when the payload omits it', () => {
    const body = JSON.stringify({
      stagedVersions: {
        objects: [{ packageName: 'a', stageId: 's1', version: '1' }],
      },
    })
    expect(parseStagedPayload(body).total).toBe(1)
  })

  it('narrows the tarball list by a scoped package filter', () => {
    const body = JSON.stringify({
      stagedVersions: {
        objects: [
          { packageName: '@scope/keep', stageId: 's1', version: '1' },
          { packageName: 'other', stageId: 's2', version: '1' },
        ],
      },
    })
    const payload = parseStagedPayload(body, '@scope/keep')
    expect(payload.tarballs.map(t => t.packageName)).toEqual(['@scope/keep'])
  })

  it('degrades a non-object JSON body to an empty envelope instead of crashing', () => {
    const payload = parseStagedPayload('null')
    expect(payload.tarballs).toEqual([])
    expect(payload.total).toBe(0)
  })

  it('throws loudly on a non-JSON body', () => {
    expect(() => parseStagedPayload('<html>Just a moment</html>')).toThrow()
  })
})
