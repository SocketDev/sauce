/**
 * The one SKILL.md frontmatter parser for the repository.
 *
 * Every agent reads SKILL.md frontmatter as YAML. This parser accepts only
 * the subset whose YAML meaning is unambiguous: top-level `key: value` pairs
 * whose values are plain or single-line quoted scalars, folded across
 * indented continuation lines, plus a one-level `metadata:` map of string
 * values (the Agent Skills spec's `metadata`). Anything a YAML parser could
 * read differently is reported as a problem rather than guessed at.
 */

export interface SkillFrontmatter {
  /**
   * The opening and closing `---` fences were found.
   */
  found: boolean
  /**
   * The closing fence is followed by a newline, as strict YAML loaders need.
   */
  terminated: boolean
  /**
   * Top-level values: a string, null for an empty value, or `{ nonString }`
   * for a scalar YAML reads as a number, boolean, or null.
   */
  fields: Map<string, unknown>
  /**
   * The `metadata:` map, when present and well formed.
   */
  metadata: Record<string, string> | undefined
  problems: string[]
}

export interface NonStringScalar {
  nonString: string
}

const OPEN_RE = /^﻿?---[ \t]*\r?\n/
const CLOSE_RE = /\r?\n---[ \t]*(?:\r?\n|$)/
const KEY_LINE_RE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/
const MAP_ENTRY_RE = /^([A-Za-z0-9_-]+):[ \t]+(.+)$/
const PLAIN_SCALAR_RE = /^[^\s'"&*!|>%@`#{}[\],?:-][^\n]*$/
const YAML_NON_STRING_RE =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)|[-+]?0b[01_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?|\d{4}-\d\d?-\d\d?(?:(?:[Tt]|[ \t]+)\d\d?:\d\d:\d\d(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?)?)$/

export function isNonStringScalar(value: unknown): value is NonStringScalar {
  return typeof value === 'object' && value !== null && 'nonString' in value
}

export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const empty: SkillFrontmatter = {
    found: false,
    terminated: false,
    fields: new Map(),
    metadata: undefined,
    problems: [],
  }
  const open = OPEN_RE.exec(text)
  if (!open) {
    return { ...empty, problems: ['missing YAML frontmatter'] }
  }
  const rest = text.slice(open[0].length - 1)
  const close = CLOSE_RE.exec(rest)
  if (!close) {
    return { ...empty, problems: ['unterminated YAML frontmatter'] }
  }
  const terminated = close[0].endsWith('\n')
  const body = rest.slice(1, close.index)
  const { raw, problems } = splitLines(body)
  const fields = new Map<string, unknown>()
  let metadata: Record<string, string> | undefined
  for (const { 0: key, 1: parts } of raw) {
    if (key === 'metadata') {
      const parsed = parseMap(parts)
      problems.push(...parsed.problems.map(p => `metadata: ${p}`))
      if (parsed.problems.length === 0) {
        metadata = parsed.map
        fields.set(key, parsed.map)
      }
      continue
    }
    const parsed = parseScalar(parts)
    if (isProblem(parsed)) {
      problems.push(`${key}: ${parsed.problem}`)
    } else {
      fields.set(key, parsed)
    }
  }
  return { found: true, terminated, fields, metadata, problems }
}

/**
 * Top-level string values only, for callers that just need `name` and
 * `description`. Unreadable lines are skipped; empty and non-string values
 * are left out.
 */
export function parseFrontmatter(
  text: string,
): Record<string, string | undefined> {
  const { fields } = parseSkillFrontmatter(text)
  const data: Record<string, string | undefined> = {}
  for (const { 0: key, 1: value } of fields) {
    if (typeof value === 'string' && value) {
      data[key] = value
    } else if (isNonStringScalar(value)) {
      data[key] = value.nonString
    }
  }
  return data
}

function splitLines(body: string): {
  raw: Map<string, string[]>
  problems: string[]
} {
  const raw = new Map<string, string[]>()
  const problems: string[] = []
  let current: string[] | undefined
  let currentKey: string | undefined
  let commentInValue = false
  for (const line of body.split(/\r?\n/)) {
    if (/^[ \t]*\t/.test(line) && line.trim() !== '') {
      problems.push(
        `line ${JSON.stringify(line)} is indented with a tab; use spaces`,
      )
      continue
    }
    if (line.trim() === '') {
      current?.push('')
      continue
    }
    if (/^\s*#/.test(line)) {
      commentInValue =
        currentKey !== 'metadata' &&
        current !== undefined &&
        current.some(Boolean)
      continue
    }
    if (/^\s/.test(line)) {
      if (!current) {
        problems.push(`unexpected indented line: ${JSON.stringify(line)}`)
      } else {
        if (commentInValue) {
          problems.push(
            `comment inside a multi-line value before ${JSON.stringify(line.trim())}`,
          )
        }
        current.push(line)
      }
      continue
    }
    commentInValue = false
    const match = KEY_LINE_RE.exec(line)
    if (!match) {
      problems.push(`cannot read frontmatter line ${JSON.stringify(line)}`)
      current = undefined
      currentKey = undefined
      continue
    }
    const key = match[1]!
    if (raw.has(key)) {
      problems.push(`duplicate key '${key}'`)
    }
    currentKey = key
    current = match[2] ? [match[2]] : []
    raw.set(key, current)
  }
  return { raw, problems }
}

function trimBlankTail(parts: string[]): string[] {
  const out = [...parts]
  while (out.length > 0 && out.at(-1)?.trim() === '') {
    out.pop()
  }
  return out
}

function parseMap(parts: string[]): {
  map: Record<string, string>
  problems: string[]
} {
  const lines = trimBlankTail(parts).filter(line => line.trim() !== '')
  const map: Record<string, string> = {}
  const problems: string[] = []
  if (lines.length === 0) {
    return { map, problems: ['must be a map of string keys to string values'] }
  }
  const indent = /^ */.exec(lines[0]!)![0]
  if (!indent) {
    return { map, problems: ['must be an indented map'] }
  }
  for (const line of lines) {
    if (/^ */.exec(line)![0] !== indent) {
      problems.push(
        `entry ${JSON.stringify(line.trim())} has inconsistent indentation`,
      )
      continue
    }
    const entry = MAP_ENTRY_RE.exec(line.trim())
    if (!entry) {
      problems.push(
        `entry ${JSON.stringify(line.trim())} must be an indented 'key: value' line`,
      )
      continue
    }
    const key = entry[1]!
    if (key in map) {
      problems.push(`duplicate key '${key}'`)
      continue
    }
    const value = parseScalar([entry[2]!])
    if (typeof value === 'string') {
      map[key] = value
    } else if (isProblem(value)) {
      problems.push(`${key}: ${value.problem}`)
    } else {
      problems.push(`${key} must be a string; quote it`)
    }
  }
  return { map, problems }
}

interface Problem {
  problem: string
}

function isProblem(value: unknown): value is Problem {
  return typeof value === 'object' && value !== null && 'problem' in value
}

const SINGLE_QUOTED_RE = /^'(?:[^']|'')*'$/
const DOUBLE_QUOTED_RE = /^"(?:[^"\\]|\\.)*"$/

function parseScalar(parts: string[]): unknown {
  const lines = trimBlankTail(parts).map(line => line.trim())
  if (lines.length === 0) {
    return null
  }
  const first = lines[0]!
  if (lines.length === 1 && SINGLE_QUOTED_RE.test(first)) {
    return first.slice(1, -1).replaceAll("''", "'")
  }
  if (lines.length === 1 && DOUBLE_QUOTED_RE.test(first)) {
    try {
      return JSON.parse(first) as string
    } catch {
      return {
        problem: `value ${JSON.stringify(first)} uses a double-quoted escape this parser cannot check; use a plain or single-quoted value`,
      }
    }
  }
  if (!PLAIN_SCALAR_RE.test(first)) {
    return {
      problem: `value ${JSON.stringify(first)} is not a plain YAML scalar; quote it or rephrase`,
    }
  }
  const value = lines
    .map(part => (part === '' ? '\n' : part))
    .join(' ')
    .replace(/ ?\n ?/g, '\n')
  if (/:\s|\s#|:$/.test(value)) {
    return {
      problem: `an unquoted value must not contain ': ', ' #', or end with ':'`,
    }
  }
  return YAML_NON_STRING_RE.test(value) ? { nonString: value } : value
}
