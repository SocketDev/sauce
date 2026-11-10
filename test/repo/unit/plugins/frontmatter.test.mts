// Specs for the repository's one SKILL.md frontmatter parser and the Agent
// Skills rules validateSkillMd applies on top of it.

import { describe, expect, it } from 'vitest'

import {
  isNonStringScalar,
  parseFrontmatter,
  parseSkillFrontmatter,
} from '../../../../scripts/repo/lib/frontmatter.mts'
import { validateSkillMd } from '../../../../scripts/repo/plugins/skills.mts'

const fm = (body: string, tail = '\n') => `---\n${body}\n---${tail}`

describe('parseSkillFrontmatter', () => {
  it('reads plain, folded, and quoted scalars', () => {
    const { fields, problems } = parseSkillFrontmatter(
      fm(
        `name: demo\ndescription:\n  Folded across\n  two lines.\nlicense: 'It''s MIT'\ncompat: "a: b"`,
      ),
    )
    expect(problems).toStrictEqual([])
    expect(Object.fromEntries(fields)).toStrictEqual({
      name: 'demo',
      description: 'Folded across two lines.',
      license: "It's MIT",
      compat: 'a: b',
    })
  })

  it('keeps a blank line inside a folded scalar as a newline', () => {
    const { fields } = parseSkillFrontmatter(fm('description:\n  one\n\n  two'))
    expect(fields.get('description')).toBe('one\ntwo')
  })

  it('reads a metadata map of strings', () => {
    const { metadata, problems } = parseSkillFrontmatter(
      fm('name: demo\nmetadata:\n  category: setup\n  requires: "a,b"'),
    )
    expect(problems).toStrictEqual([])
    expect(metadata).toStrictEqual({ category: 'setup', requires: 'a,b' })
  })

  it.each([
    ['an empty map', 'metadata:', 'must be a map'],
    ['an inline value', 'metadata: x', 'must be an indented'],
    ['a non-string value', 'metadata:\n  count: 3', 'count must be a string'],
    ['a duplicate key', 'metadata:\n  a: x\n  a: y', "duplicate key 'a'"],
    ['a nested map', 'metadata:\n  a:\n    b: c', 'must be an indented'],
    ['a list', 'metadata:\n  - x', 'must be an indented'],
    [
      'a deeper second entry',
      'metadata:\n  a: x\n    b: y',
      'inconsistent indentation',
    ],
    [
      'a shallower second entry',
      'metadata:\n    a: x\n  b: y',
      'inconsistent indentation',
    ],
    ['tab indentation', 'metadata:\n\ta: x', 'indented with a tab'],
  ])('rejects metadata with %s', (_label, body, message) => {
    const { metadata, problems } = parseSkillFrontmatter(fm(body))
    expect(metadata).toBeUndefined()
    expect(problems.join('\n')).toContain(message)
  })

  it.each([
    ['null', 'null'],
    ['tilde', '~'],
    ['an integer', '123'],
    ['a float', '1.5e3'],
    ['a boolean', 'true'],
    ['a YAML 1.1 boolean', 'yes'],
    ['hex', '0x1F'],
    ['infinity', '.inf'],
  ])('marks %s as a non-string scalar', (_label, value) => {
    const value_ = parseSkillFrontmatter(fm(`x: ${value}`)).fields.get('x')
    expect(isNonStringScalar(value_)).toBe(true)
  })

  it('allows blank lines and comments between metadata entries', () => {
    const { metadata, problems } = parseSkillFrontmatter(
      fm('metadata:\n  a: x\n\n  # note\n  b: y'),
    )
    expect(problems).toStrictEqual([])
    expect(metadata).toStrictEqual({ a: 'x', b: 'y' })
  })

  it.each([
    ['sexagesimal', '1:30'],
    ['binary', '0b101'],
    ['a date', '2024-01-01'],
    ['a timestamp', '2024-01-01T10:00:00Z'],
  ])('marks %s as a non-string scalar', (_label, value) => {
    const parsed = parseSkillFrontmatter(fm(`x: "${value}"\ny: ${value}`))
    expect(parsed.fields.get('x')).toBe(value)
    expect(isNonStringScalar(parsed.fields.get('y'))).toBe(true)
  })

  it('treats an empty value as null', () => {
    expect(parseSkillFrontmatter(fm('x:')).fields.get('x')).toBeNull()
  })

  it('strips a byte-order mark', () => {
    expect(
      parseSkillFrontmatter(`\uFEFF${fm('name: demo')}`).fields.get('name'),
    ).toBe('demo')
  })

  it('accepts CRLF line endings', () => {
    const { fields, terminated } = parseSkillFrontmatter(
      '---\r\nname: demo\r\ndescription: x\r\n---\r\n',
    )
    expect(terminated).toBe(true)
    expect(fields.get('description')).toBe('x')
  })

  it('reports a closing fence at EOF without a newline as unterminated', () => {
    const result = parseSkillFrontmatter(fm('name: demo', ''))
    expect(result.found).toBe(true)
    expect(result.terminated).toBe(false)
  })

  it('ignores comments', () => {
    const { fields, problems } = parseSkillFrontmatter(
      fm('# a comment\nname: demo\n  # indented comment'),
    )
    expect(problems).toStrictEqual([])
    expect(fields.get('name')).toBe('demo')
  })
})

describe('parseFrontmatter', () => {
  it('returns string fields and skips unreadable lines', () => {
    expect(
      parseFrontmatter(fm('name: test\nthis is not yaml\ndescription: desc')),
    ).toStrictEqual({ name: 'test', description: 'desc' })
  })

  it('returns a non-string scalar as its text', () => {
    expect(parseFrontmatter(fm('a: true'))['a']).toBe('true')
  })

  it('leaves out empty values and maps', () => {
    expect(
      parseFrontmatter(fm('name:\ndescription: valid\nmetadata:\n  a: b')),
    ).toStrictEqual({ description: 'valid' })
  })

  it('returns nothing without frontmatter', () => {
    expect(parseFrontmatter('no frontmatter')).toStrictEqual({})
    expect(parseFrontmatter('---\nname: test\nno closing')).toStrictEqual({})
  })
})

describe('validateSkillMd', () => {
  const ok = (body: string) => validateSkillMd('demo', fm(body))

  it.each([
    ['plain values', 'name: demo\ndescription: Plain text.'],
    ['a folded description', 'name: demo\ndescription:\n  Folded\n  text.'],
    ['quoted values', `name: "demo"\ndescription: 'It''s: fine'`],
    [
      'an unknown boolean key',
      'name: demo\ndescription: x\ndisable-model-invocation: true',
    ],
    ['a license', 'name: demo\ndescription: x\nlicense: MIT'],
    ['a compatibility', 'name: demo\ndescription: x\ncompatibility: Node 24+'],
    ['allowed-tools', 'name: demo\ndescription: x\nallowed-tools: Read Bash'],
    ['metadata', 'name: demo\ndescription: x\nmetadata:\n  category: fix'],
  ])('accepts %s', (_label, body) => {
    expect(ok(body)).toStrictEqual([])
  })

  it('accepts a 1024-character description and a 64-character name', () => {
    const name = 'a'.repeat(64)
    expect(
      validateSkillMd(
        name,
        fm(`name: ${name}\ndescription: ${'x'.repeat(1024)}`),
      ),
    ).toStrictEqual([])
  })

  it.each([
    ['no frontmatter', '# demo\n', 'missing YAML frontmatter'],
    [
      'a fence at EOF without a newline',
      fm('name: demo\ndescription: x', ''),
      'unterminated YAML frontmatter',
    ],
    ['no closing fence', '---\nname: demo\n', 'unterminated YAML frontmatter'],
  ])('rejects %s', (_label, text, message) => {
    expect(validateSkillMd('demo', text)).toStrictEqual([message])
  })

  it.each([
    ['an empty quoted description', 'description: ""', 'description must be'],
    ['a null description', 'description: null', 'description must be'],
    ['a numeric description', 'description: 123', 'description must be'],
    ['a boolean description', 'description: yes', 'description must be'],
    ['a missing description', 'license: MIT', 'description must be'],
    ['an empty description', 'description:', 'description must be'],
    [
      'a description over 1024 characters',
      `description: ${'x'.repeat(1025)}`,
      'description must be',
    ],
    [
      'an unquoted colon-space',
      'description: Use it: scan',
      "must not contain ': '",
    ],
    [
      'a colon-space on a continuation line',
      'description:\n  first\n  then: oops',
      "must not contain ': '",
    ],
    ['a trailing colon', 'description: ends with:', "must not contain ': '"],
    ['an unquoted comment marker', 'description: deps # more', "' #'"],
    ['a block scalar', 'description: >\n  folded', 'not a plain YAML scalar'],
    ['a flow sequence', 'description: [a, b]', 'not a plain YAML scalar'],
    ['an anchor', 'description: &a text', 'not a plain YAML scalar'],
    [
      'a multi-line quoted string',
      'description: "a\n  b"',
      'not a plain YAML scalar',
    ],
    ['a duplicate key', 'description: a\ndescription: b', 'duplicate key'],
    [
      'a non-string license',
      'description: x\nlicense: 1',
      'license must be a string',
    ],
    [
      'a boolean allowed-tools',
      'description: x\nallowed-tools: true',
      'allowed-tools must be a string',
    ],
    [
      'a list of allowed-tools',
      'description: x\nallowed-tools: [Read]',
      'not a plain YAML scalar',
    ],
    [
      'an empty compatibility',
      "description: x\ncompatibility: ''",
      'compatibility must be',
    ],
    [
      'a long compatibility',
      `description: x\ncompatibility: ${'c'.repeat(501)}`,
      'compatibility must be',
    ],
    ['bad metadata', 'description: x\nmetadata: x', 'metadata:'],
    [
      'a line without a key',
      'description: x\njust words',
      'cannot read frontmatter line',
    ],
  ])('rejects %s', (_label, rest, message) => {
    expect(ok(`name: demo\n${rest}`).join('\n')).toContain(message)
  })

  it('rejects an indented line before any key', () => {
    expect(
      validateSkillMd('demo', fm('  oops\nname: demo\ndescription: x')),
    ).toStrictEqual(['unexpected indented line: "  oops"'])
  })

  it.each([
    ['a name that differs from its directory', 'other'],
    ['an uppercase name', 'Demo'],
    ['a double hyphen', 'de--mo'],
    ['a trailing hyphen', 'demo-'],
    ['an underscore', 'de_mo'],
    ['a quoted different name', '"other"'],
  ])('rejects %s', (_label, name) => {
    expect(
      validateSkillMd('demo', fm(`name: ${name}\ndescription: x`)).join('\n'),
    ).toContain("must equal its directory name 'demo'")
  })

  it.each([['Demo'], ['de--mo'], ['demo-'], ['de_mo']])(
    'rejects the badly formed name %j even when it matches its directory',
    name => {
      expect(
        validateSkillMd(name, fm(`name: ${name}\ndescription: x`)).join('\n'),
      ).toContain('be a valid skill name')
    },
  )

  it('rejects a 65-character name even when it matches its directory', () => {
    const name = 'a'.repeat(65)
    expect(
      validateSkillMd(name, fm(`name: ${name}\ndescription: x`)),
    ).toHaveLength(1)
  })
})
