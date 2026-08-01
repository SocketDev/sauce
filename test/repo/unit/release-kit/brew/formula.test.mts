/**
 * @file Formula render/parse/plan: byte-exact render vs the golden, the
 *   parse round-trip vs the parsed golden, planFormulaBump's three actions,
 *   className edges, and the unparseable-never-throws contract. The
 *   round-trip property runs over a small spec matrix (deterministic
 *   property-style loop).
 */

import { describe, expect, it } from 'vitest'

import {
  FORMULA_PLATFORMS,
  parseFormula,
  planFormulaBump,
  renderFormula,
  versionFromUrl,
} from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import type { FormulaSpec } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/formula.mts'
import { formulaClassName } from '../../../../../release-kit/payload/scripts/socket-release/publish-infra/brew/shared.mts'
import { fixture } from '../helpers.mts'

function spec(version = '1.2.3', shaSeed = ['1', '2', '3', '4']): FormulaSpec {
  const platforms = {} as FormulaSpec['platforms']
  for (let i = 0; i < FORMULA_PLATFORMS.length; i += 1) {
    const p = FORMULA_PLATFORMS[i]!
    platforms[p] = {
      sha256: shaSeed[i]!.repeat(64),
      url: `https://github.com/SocketDev/example-cli/releases/download/v${version}/examplecli-${p}.tar.gz`,
    }
  }
  return {
    className: 'Examplecli',
    desc: 'examplecli (Socket release)',
    homepage: 'https://github.com/SocketDev/example-cli',
    license: 'MIT',
    name: 'examplecli',
    platforms,
  }
}

describe('renderFormula', () => {
  // BYTE-PIN EXCEPTION: the golden formula is a byte contract with Homebrew.
  it('renders byte-exact against examplecli-fresh.golden.rb', () => {
    expect(renderFormula(spec())).toBe(
      fixture('formula/examplecli-fresh.golden.rb'),
    )
  })

  it('URLs are exact v<version> pins, never latest', () => {
    const rendered = renderFormula(spec())
    expect(rendered).toContain('/releases/download/v1.2.3/')
    expect(rendered).not.toContain('/releases/latest')
  })
})

describe('parseFormula', () => {
  it('round-trips the render (vs examplecli-parsed.golden.json)', () => {
    const parsed = parseFormula(renderFormula(spec()))
    expect(parsed).toEqual(
      JSON.parse(fixture('formula/examplecli-parsed.golden.json')),
    )
    expect(parsed?.version).toBe('1.2.3')
    expect(parsed?.name).toBe('examplecli')
    expect(Object.keys(parsed?.platforms ?? {})).toHaveLength(4)
  })

  it('an unparseable file returns undefined — never throws', () => {
    expect(
      parseFormula(fixture('formula/examplecli-unparseable.rb')),
    ).toBeUndefined()
  })
})

describe('planFormulaBump', () => {
  it('create / update / unchanged', () => {
    expect(planFormulaBump(undefined, spec()).action).toBe('create')
    expect(
      planFormulaBump(fixture('formula/examplecli-existing.rb'), spec()).action,
    ).toBe('update')
    expect(planFormulaBump(renderFormula(spec()), spec()).action).toBe(
      'unchanged',
    )
  })

  it('unchanged iff version AND all four url/sha256 pairs match', () => {
    const drifted = spec()
    drifted.platforms['linux-x64'] = {
      ...drifted.platforms['linux-x64'],
      sha256: '9'.repeat(64),
    }
    expect(planFormulaBump(renderFormula(spec()), drifted).action).toBe(
      'update',
    )
  })

  it('an unparseable current file is an update (replace-whole-file), never a crash', () => {
    expect(
      planFormulaBump(fixture('formula/examplecli-unparseable.rb'), spec())
        .action,
    ).toBe('update')
  })

  it('property: plan(render(spec), spec).action === unchanged across a spec matrix', () => {
    const versions = ['0.1.0', '1.2.3', '10.20.30']
    const seeds = [
      ['a', 'b', 'c', 'd'],
      ['1', '2', '3', '4'],
      ['f', 'e', 'd', 'c'],
    ]
    for (const version of versions) {
      for (const seed of seeds) {
        const s = spec(version, seed)
        expect(planFormulaBump(renderFormula(s), s).action).toBe('unchanged')
      }
    }
  })
})

describe('edges', () => {
  it('versionFromUrl extracts the pinned tag version', () => {
    expect(
      versionFromUrl(
        'https://github.com/a/b/releases/download/v9.9.9/x.tar.gz',
      ),
    ).toBe('9.9.9')
    expect(versionFromUrl('https://example.com/no-release')).toBeUndefined()
  })

  it('formulaClassName splits on -_. and capitalizes', () => {
    expect(formulaClassName('example-cli')).toBe('ExampleCli')
    expect(formulaClassName('my_tool.next')).toBe('MyToolNext')
  })

  it('a digit-leading token throws', () => {
    expect(() => formulaClassName('7zip')).toThrowError(
      'Homebrew class names cannot start with a digit',
    )
  })
})
