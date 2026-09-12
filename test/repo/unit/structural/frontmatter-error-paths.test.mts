import { describe, expect, it } from 'vitest'

import { parseFrontmatter } from '../../../../scripts/repo/lib/frontmatter.mts'

describe('parseFrontmatter() error paths', () => {
  it('returns empty object for missing --- delimiters', () => {
    const result = parseFrontmatter('no frontmatter here\njust content')
    expect(result).toEqual({})
  })

  it('returns empty object for empty frontmatter', () => {
    const result = parseFrontmatter('---\n---\nsome content')
    expect(result).toEqual({})
  })

  it('returns empty object for single --- delimiter', () => {
    const result = parseFrontmatter('---\nname: test\nno closing')
    expect(result).toEqual({})
  })

  it('returns partial data when name is present but description missing', () => {
    const result = parseFrontmatter('---\nname: test\n---\ncontent')
    expect(result['name']).toBe('test')
    expect(result['description']).toBeUndefined()
  })

  it('returns partial data when description is present but name missing', () => {
    const result = parseFrontmatter(
      '---\ndescription: a test skill\n---\ncontent',
    )
    expect(result['description']).toBe('a test skill')
    expect(result['name']).toBeUndefined()
  })

  it('handles malformed YAML (lines without colons)', () => {
    const result = parseFrontmatter(
      '---\nname: test\nthis is not yaml\ndescription: desc\n---',
    )
    expect(result['name']).toBe('test')
    expect(result['description']).toBe('desc')
  })

  it('handles empty values after colon', () => {
    const result = parseFrontmatter('---\nname:\ndescription: valid\n---')
    expect(result['name']).toBeUndefined()
    expect(result['description']).toBe('valid')
  })

  it('folds indented continuation lines after an inline value', () => {
    const result = parseFrontmatter(
      '---\ndescription: first words,\n  followed by more words.\n---',
    )
    expect(result['description']).toBe('first words, followed by more words.')
  })
})
