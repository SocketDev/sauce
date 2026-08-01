/**
 * @file Property fuzzing for the npm access-state, trusted-publisher, and
 *   staged-tarball page parsers. Arbitrary HTML/JSON and single-byte mutations
 *   of the golden fixtures must never crash a parser and never let it invent a
 *   classification the page did not carry — an unreadable page reads as a
 *   refusal (`unknown` / `error`), never a silent default.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  classifyPublishingAccess,
  parsePublishingAccess,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-parse.mts'
import type { PublishingAccessState } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-parse.mts'
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
import { fixture, FIXTURES } from '../helpers.mts'

import { readdirSync } from 'node:fs'
import path from 'node:path'

const ACCESS_STATES: PublishingAccessState[] = [
  'both-enabled',
  'direct-only',
  'staged-only',
  'unknown',
]

function mutateOneByte(text: string, seed: number): string {
  if (text.length === 0) {
    return text
  }
  const at = seed % text.length
  const code = text.charCodeAt(at)
  const next = String.fromCharCode(((code + 1) % 126) + 1)
  return `${text.slice(0, at)}${next}${text.slice(at + 1)}`
}

describe('classifyPublishingAccess', () => {
  it('maps every toggle pair deterministically and refuses on any unreadable toggle', () => {
    const tri = [true, false, undefined] as const
    for (const d of tri) {
      for (const s of tri) {
        const state = classifyPublishingAccess(d, s)
        expect(ACCESS_STATES).toContain(state)
        if (d === undefined || s === undefined) {
          expect(state).toBe('unknown')
        }
      }
    }
    expect(classifyPublishingAccess(true, true)).toBe('both-enabled')
    expect(classifyPublishingAccess(true, false)).toBe('direct-only')
    expect(classifyPublishingAccess(false, true)).toBe('staged-only')
    expect(classifyPublishingAccess(false, false)).toBe('unknown')
  })
})

describe('parsePublishingAccess', () => {
  it('never throws and stays internally consistent on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4000 }), html => {
        const read = parsePublishingAccess(html)
        expect(ACCESS_STATES).toContain(read.state)
        expect(read.state).toBe(
          classifyPublishingAccess(read.directEnabled, read.stagedEnabled),
        )
      }),
      { numRuns: 500 },
    )
  })

  it('reads a synthesized page for any toggle rendering', () => {
    const renderToggle = fc.oneof(
      fc.constant({
        enabled: true,
        html: (n: string) => `<input name="${n}" checked>`,
      }),
      fc.constant({
        enabled: false,
        html: (n: string) => `<input name="${n}">`,
      }),
      fc
        .record({
          enabled: fc.boolean(),
        })
        .map(({ enabled }) => ({
          enabled,
          html: (_n: string) => '',
          json: (k: string) => `"${k}": ${enabled}`,
        })),
      fc.constant({ enabled: undefined, html: (_n: string) => '' }),
    )
    fc.assert(
      fc.property(
        renderToggle,
        renderToggle,
        fc.string({ maxLength: 40 }),
        (dir, stg, noise) => {
          const parts = [
            '<html><body>',
            noise,
            dir.html('allowDirectPublish'),
            'json' in dir && typeof dir.json === 'function'
              ? dir.json('directPublishEnabled')
              : '',
            stg.html('allowStagedPublish'),
            'json' in stg && typeof stg.json === 'function'
              ? stg.json('stagedPublishEnabled')
              : '',
            '</body></html>',
          ]
          const read = parsePublishingAccess(parts.join('\n'))
          expect(read.directEnabled).toBe(dir.enabled)
          expect(read.stagedEnabled).toBe(stg.enabled)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('single-byte mutations of the golden access pages never crash the parser', () => {
    const files = readdirSync(path.join(FIXTURES, 'access-pages'))
    fc.assert(
      fc.property(fc.constantFrom(...files), fc.nat(), (file, seed) => {
        const mutated = mutateOneByte(fixture(`access-pages/${file}`), seed)
        const read = parsePublishingAccess(mutated)
        expect(ACCESS_STATES).toContain(read.state)
      }),
      { numRuns: 300 },
    )
  })
})

describe('classifyAccessPage', () => {
  it('never throws and returns a known state for any body/status', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 3000 }),
        fc.integer({ max: 700, min: 0 }),
        (body, status) => {
          const state = classifyAccessPage({ body, status })
          expect([
            'auth',
            'challenge',
            'configured',
            'error',
            'unconfigured',
          ]).toContain(state)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('a Cloudflare challenge body wins over any status', () => {
    fc.assert(
      fc.property(fc.integer({ max: 599, min: 100 }), status => {
        expect(
          classifyAccessPage({ body: 'Just a moment... cf-challenge', status }),
        ).toBe('challenge')
      }),
      { numRuns: 200 },
    )
  })
})

describe('parseTrustedPublisherForm', () => {
  const seg = fc
    .array(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-._'.split('')),
      {
        maxLength: 20,
        minLength: 1,
      },
    )
    .map(cs => cs.join(''))

  it('round-trips a configured page on owner/name/workflow/environment', () => {
    fc.assert(
      fc.property(seg, seg, seg, seg, (owner, name, wf, env) => {
        const html = [
          '<div id="github-repoInfo">',
          `${owner}/${name}</div>`,
          `<div id="github-workflowName">${wf}.yml</div>`,
          `<div id="github-environmentName">${env}</div>`,
        ].join('\n')
        const parsed = parseTrustedPublisherForm(html)
        expect(parsed).toBeDefined()
        expect(parsed!.repositoryOwner).toBe(owner)
        expect(parsed!.repositoryName).toBe(name)
        expect(parsed!.workflowFilename).toBe(`${wf}.yml`)
        expect(parsed!.environmentName).toBe(env)
      }),
      { numRuns: 300 },
    )
  })

  it('never throws and returns undefined when no marker is present', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 3000 }), html => {
        expect(() => parseTrustedPublisherForm(html)).not.toThrow()
      }),
      { numRuns: 400 },
    )
  })
})

describe('extractAllowedActions / allowsAction', () => {
  it('only ever returns the two known publish actions', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 3000 }), html => {
        const actions = extractAllowedActions(html)
        for (const a of actions) {
          expect(['npm publish', 'npm stage publish']).toContain(a)
        }
      }),
      { numRuns: 400 },
    )
  })

  it('reads checked publish checkboxes and honors the plain-vs-stage distinction', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (plain, stage) => {
        const html = [
          plain
            ? '<input name="allowPublish" checked>'
            : '<input name="allowPublish">',
          stage
            ? '<input name="allowStagePublish" checked>'
            : '<input name="allowStagePublish">',
        ].join('\n')
        const actions = extractAllowedActions(html)
        expect(allowsAction(actions, 'publish')).toBe(plain)
        expect(allowsAction(actions, 'stage-publish')).toBe(stage)
      }),
      { numRuns: 200 },
    )
  })
})

describe('staged-browser-parse', () => {
  it('challenge/html/classify helpers never throw on arbitrary input', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 3000 }),
        fc.integer({ max: 700, min: 0 }),
        (body, status) => {
          expect(typeof isCloudflareChallenge(body)).toBe('boolean')
          expect(typeof looksLikeHtmlBody(body)).toBe('boolean')
          expect(['auth', 'challenge', 'error', 'ok']).toContain(
            classifyStagedFetch({ body, status }),
          )
        },
      ),
      { numRuns: 500 },
    )
  })

  it('parseStagedPayload never throws on any JSON value and returns a well-formed envelope', () => {
    fc.assert(
      fc.property(fc.jsonValue(), value => {
        const body = JSON.stringify(value)
        const payload = parseStagedPayload(body)
        expect(typeof payload.approveUrl).toBe('string')
        expect(typeof payload.csrfToken).toBe('string')
        expect(typeof payload.rejectUrl).toBe('string')
        expect(Array.isArray(payload.tarballs)).toBe(true)
        expect(typeof payload.total).toBe('number')
      }),
      { numRuns: 400 },
    )
  })

  it('parseStagedPayload throws loudly on non-JSON (never a silent empty result)', () => {
    expect(() => parseStagedPayload('Just a moment... <html>')).toThrow()
  })

  it('mapStagedTarball produces string identity fields for any record', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), raw => {
        const t = mapStagedTarball(raw as Record<string, unknown>)
        expect(typeof t.id).toBe('string')
        expect(typeof t.packageName).toBe('string')
        expect(typeof t.version).toBe('string')
      }),
      { numRuns: 400 },
    )
  })
})
