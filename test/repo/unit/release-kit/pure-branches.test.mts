/**
 * @file Residual branch coverage for the pure modules: the throw/edge arms in
 *   the brew class-name deriver, the access-plan idempotence + refusal, the
 *   formula parse-path no-op, the trusted-publisher repo/workflow edges, the
 *   installer seam fallbacks, and the manifest kitVersion default.
 */

import { describe, expect, it } from 'vitest'

import { formulaClassName } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/shared.mts'
import {
  accessMatchesDesired,
  diffPublishingAccess,
} from '../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-plan.mts'
import type { PublishingAccessDesired } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-plan.mts'
import type { PublishingAccessRead } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-parse.mts'
import {
  parseFormula,
  planFormulaBump,
  renderFormula,
} from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import type { FormulaSpec } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import { FORMULA_PLATFORMS } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import { parseTrustedPublisherForm } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/trusted-publisher-parse.mts'
import { parseKitManifest } from '../../../../release-kit/install/manifest.mts'
import { resolveInstallSeams } from '../../../../release-kit/install/seams.mts'

function spec(version = '1.2.3'): FormulaSpec {
  const platforms = {} as FormulaSpec['platforms']
  for (let i = 0; i < FORMULA_PLATFORMS.length; i += 1) {
    const p = FORMULA_PLATFORMS[i]!
    platforms[p] = {
      sha256: `${i}`.repeat(64),
      url: `https://github.com/o/r/releases/download/v${version}/r-${p}.tar.gz`,
    }
  }
  return {
    className: 'R',
    desc: 'r',
    homepage: 'https://github.com/o/r',
    license: 'MIT',
    name: 'r',
    platforms,
  }
}

describe('formulaClassName edge arms', () => {
  it('throws when the name yields no tokens', () => {
    expect(() => formulaClassName('---')).toThrow(/no tokens/)
    expect(() => formulaClassName('')).toThrow(/no tokens/)
  })

  it('throws when the first token starts with a digit', () => {
    expect(() => formulaClassName('1cli')).toThrow(/cannot start with a digit/)
  })

  it('capitalizes and joins multi-token names', () => {
    expect(formulaClassName('example-cli.tool')).toBe('ExampleCliTool')
  })
})

describe('accessMatchesDesired', () => {
  const desired: PublishingAccessDesired = {
    directEnabled: false,
    stagedEnabled: true,
  }
  it('an unknown read never matches', () => {
    const read: PublishingAccessRead = {
      directEnabled: undefined,
      stagedEnabled: undefined,
      state: 'unknown',
    }
    expect(accessMatchesDesired(read, desired)).toBe(false)
  })

  it('a readable matching pair matches', () => {
    const read: PublishingAccessRead = {
      directEnabled: false,
      stagedEnabled: true,
      state: 'staged-only',
    }
    expect(accessMatchesDesired(read, desired)).toBe(true)
  })

  it('a readable differing pair does not match', () => {
    const read: PublishingAccessRead = {
      directEnabled: true,
      stagedEnabled: true,
      state: 'both-enabled',
    }
    expect(accessMatchesDesired(read, desired)).toBe(false)
  })
})

describe('diffPublishingAccess', () => {
  it('refuses to plan against an unknown read', () => {
    expect(() =>
      diffPublishingAccess(
        {
          directEnabled: undefined,
          stagedEnabled: undefined,
          state: 'unknown',
        },
        { directEnabled: false, stagedEnabled: true },
      ),
    ).toThrow(/unknown/)
  })

  it('emits only the toggles that differ', () => {
    const edits = diffPublishingAccess(
      { directEnabled: true, stagedEnabled: false, state: 'direct-only' },
      { directEnabled: false, stagedEnabled: true },
    )
    expect(edits).toEqual([
      { checkbox: 'allowDirectPublish', to: false },
      { checkbox: 'allowStagedPublish', to: true },
    ])
  })

  it('emits no edits when the read already matches', () => {
    const edits = diffPublishingAccess(
      { directEnabled: false, stagedEnabled: true, state: 'staged-only' },
      { directEnabled: false, stagedEnabled: true },
    )
    expect(edits).toEqual([])
  })
})

describe('planFormulaBump parse path', () => {
  it('a byte-different but semantically identical formula is unchanged', () => {
    const rendered = renderFormula(spec())
    const withTrailingComment = `${rendered}# an extra trailing comment\n`
    expect(withTrailingComment).not.toBe(rendered)
    expect(parseFormula(withTrailingComment)).toBeDefined()
    expect(planFormulaBump(withTrailingComment, spec()).action).toBe(
      'unchanged',
    )
  })

  it('a parseable formula at a different version is an update', () => {
    const current = renderFormula(spec('1.0.0'))
    expect(planFormulaBump(current, spec('2.0.0')).action).toBe('update')
  })
})

describe('parseTrustedPublisherForm repo/workflow edges', () => {
  it('a trailing-slash repo has an undefined name', () => {
    const parsed = parseTrustedPublisherForm(
      '<span id="github-repoInfo">owner/</span>',
    )
    expect(parsed!.repositoryOwner).toBe('owner')
    expect(parsed!.repositoryName).toBeUndefined()
  })

  it('a leading-slash repo has an undefined owner', () => {
    const parsed = parseTrustedPublisherForm(
      '<span id="github-repoInfo">/name</span>',
    )
    expect(parsed!.repositoryOwner).toBeUndefined()
    expect(parsed!.repositoryName).toBe('name')
  })

  it('an empty workflow marker reads as undefined', () => {
    const parsed = parseTrustedPublisherForm(
      '<span id="github-repoInfo">o/r</span><span id="github-workflowName"> </span>',
    )
    expect(parsed!.workflowFilename).toBeUndefined()
  })

  it('a Permissions block with only unrelated chips grants nothing', () => {
    const parsed = parseTrustedPublisherForm(
      '<span id="github-repoInfo">o/r</span>Permissions:</span><div><code>read only</code></div>',
    )
    expect(parsed!.allowedActions).toEqual([])
  })
})

describe('installer seam fallbacks', () => {
  it('readPayloadFile and hashTargetFile return undefined for missing files', () => {
    const seams = resolveInstallSeams('/nonexistent-payload-root')
    expect(seams.readPayloadFile('nope.mts')).toBeUndefined()
    expect(
      seams.hashTargetFile('nope.mts', '/nonexistent-target'),
    ).toBeUndefined()
  })
})

describe('parseKitManifest kitVersion default', () => {
  it('defaults kitVersion when the field is absent or non-string', () => {
    const raw = JSON.stringify({
      files: [{ channels: ['common'], path: 'a.mts', sha256: 'a'.repeat(64) }],
      schemaVersion: 1,
    })
    expect(parseKitManifest(raw, 'test').kitVersion).toBeTruthy()
  })
})
