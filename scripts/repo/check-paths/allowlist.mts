/**
 * @file Allowlist parsing + matching for the path-hygiene gate. Loads
 *   `.github/paths-allowlist.yml` with a tiny purpose-built YAML subset parser
 *   (entries with scalar fields plus YAML 1.2 `|` / `>` block scalars for
 *   multi-line `reason` text) so the gate stays self-contained — usable inside
 *   socket-lib itself, where adding a `yaml` dep would create a circular
 *   dependency. `snippetHash` produces a whitespace-insensitive, 12-hex-char
 *   SHA-256 prefix used as a drift-tolerant key in allowlist entries.
 *   `isAllowlisted` matches a finding against any combination of `rule` /
 *   `file` / `pattern` / `line` / `snippet_hash` filters; the line/hash check
 *   is OR'd so reformatting that shifts the line still matches via the hash.
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { AllowlistEntry, Finding } from './types.mts'

export const unquote = (s: string): string => {
  const t = s.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

// oxlint-disable-next-line eslint/complexity -- format validation branches
export const loadAllowlist = (repoRoot: string): AllowlistEntry[] => {
  const allowlistPath = path.join(repoRoot, '.github', 'paths-allowlist.yml')
  if (!existsSync(allowlistPath)) {
    return []
  }
  const text = readFileSync(allowlistPath, 'utf8')
  // Tiny YAML parser — only the shape we need: list of entries with
  // `file`, `pattern`, `rule`, `line`, `reason` scalar fields, plus
  // YAML 1.2 block-scalar indicators `|` (literal) and `>` (folded)
  // for multi-line reasons. Avoids a yaml dep for a gate that has to
  // be self-contained.
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> | undefined = undefined
  // When set, subsequent more-indented lines fold into this key as a
  // block scalar (literal '|' keeps newlines, folded '>' joins with
  // spaces).
  let blockKey: string | undefined = undefined
  let blockKind: '|' | '>' | undefined = undefined
  let blockIndent = 0
  let blockLines: string[] = []
  const flushBlock = () => {
    if (current && blockKey) {
      const value =
        blockKind === '>'
          ? blockLines.join(' ').replace(/\s+/g, ' ').trim()
          : blockLines.join('\n').replace(/\n+$/, '')
      ;(current as Record<string, unknown>)[blockKey] = value
    }
    blockKey = undefined
    blockKind = undefined
    blockLines = []
  }
  const getAllowlistIndent = (line: string): number => {
    let index = 0
    while (index < line.length && line.charCodeAt(index) === 32 /* ' ' */) {
      index += 1
    }
    return index
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const line = raw.replace(/\r$/, '')
    // Block-scalar accumulation takes precedence over normal parsing.
    if (blockKey !== undefined) {
      if (line.trim() === '') {
        // Preserve blank lines inside a literal block; folded blocks
        // turn them into paragraph breaks and keep them as separate joins.
        blockLines.push('')
        continue
      }
      const indent = getAllowlistIndent(line)
      if (indent >= blockIndent) {
        blockLines.push(line.slice(blockIndent))
        continue
      }
      flushBlock()
      // Fall through and re-process the dedented line as normal.
    }
    if (!line.trim() || line.trim().startsWith('#')) {
      continue
    }
    const tryAssign = (key: string, value: string) => {
      const trimmed = value.trim()
      if (current === undefined) {
        return
      }
      if (trimmed === '>' || trimmed === '|') {
        blockKey = key
        blockKind = trimmed
        blockIndent =
          getAllowlistIndent(lines[i + 1] ?? '') || getAllowlistIndent(line) + 2
        blockLines = []
        return
      }
      // Keys come from the YAML parse; unknown keys land as extra properties
      // and are ignored by every AllowlistEntry consumer.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- see above
      ;(current as Record<string, unknown>)[key] =
        key === 'line' ? Number(unquote(trimmed)) : unquote(trimmed)
    }
    if (line.startsWith('- ')) {
      if (current?.reason) {
        // `reason` is the only required field; the guard above proves it.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion -- see above
        entries.push(current as AllowlistEntry)
      }
      current = {}
      const rest = line.slice(2).trim()
      if (rest) {
        // Matches a `key: value` pair on a YAML list-entry line, e.g.
        // `- pattern: foo/**` — group 1 is the key, group 2 is the value.
        const m = rest.match(/^([\w-]+):\s*(.*)$/)
        if (m) {
          tryAssign(m[1]!, m[2]!)
        }
      }
    } else if (current) {
      // Matches an indented `key: value` line (a field nested under a list
      // entry) — group 1 is the key, group 2 is the value.
      const m = line.match(/^\s+([\w-]+):\s*(.*)$/)
      if (m) {
        tryAssign(m[1]!, m[2]!)
      }
    }
  }
  if (blockKey !== undefined) {
    flushBlock()
  }
  if (current?.reason) {
    // `reason` is the only required field; the guard above proves it.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    entries.push(current as AllowlistEntry)
  }
  return entries
}

/**
 * Stable, normalized snippet hash. Whitespace-insensitive so trivial
 * reformatting (indent change, trailing comma, line wrap) doesn't invalidate an
 * allowlist entry, but content-changing edits do. The hash exposes only the
 * first 12 hex chars (~48 bits) which is plenty for collision-resistance within
 * a single repo's finding set and keeps the YAML readable.
 */
export const snippetHash = (snippet: string): string => {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 12)
}

/**
 * Allowlist matching trades off two failure modes:
 *
 * - Drift via reformatting (a line shift breaks an entry, the finding
 *   re-surfaces, devs hide with a new entry).
 * - Stealth allowlisting (an entry pinned to "anywhere in this file" silently
 *   exempts unrelated future violations).
 *
 * Strategy: exact line match OR `snippet_hash` match (whitespace- normalized
 * SHA-256, first 12 hex). Either is sufficient. Lines stay exact (was ±2; the
 * slack let reformatting silently slide), and `snippet_hash` provides
 * reformatting-tolerant matching that's still tied to the literal text —
 * paste-and-edit cheating would change the hash. If neither `line` nor
 * `snippet_hash` is provided, the entry matches purely by `rule` + `file` +
 * `pattern` (file-level exempt; use sparingly and always pair with a precise
 * `pattern`).
 */
export const isAllowlisted = (
  finding: Finding,
  allowlist: readonly AllowlistEntry[],
): boolean =>
  allowlist.some(entry => {
    if (entry.rule && entry.rule !== finding.rule) {
      return false
    }
    if (entry.file && !finding.file.includes(entry.file)) {
      return false
    }
    if (entry.pattern && !finding.snippet.includes(entry.pattern)) {
      return false
    }
    const lineProvided = entry.line !== undefined
    const hashProvided =
      typeof entry.snippet_hash === 'string' && entry.snippet_hash.length > 0
    if (lineProvided || hashProvided) {
      const lineMatches = lineProvided && entry.line === finding.line
      const hashMatches =
        hashProvided && entry.snippet_hash === snippetHash(finding.snippet)
      if (!(lineMatches || hashMatches)) {
        return false
      }
    }
    return true
  })
