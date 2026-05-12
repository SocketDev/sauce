/**
 * Parse YAML frontmatter from a Markdown file.
 *
 * Handles multi-line values:
 *   - `key: value` — set immediately.
 *   - `key:` followed by indented continuation lines — the continuation
 *     fills in the value (joined with single spaces). YAML
 *     block-scalar / folded-style shape used in many SKILL.md files.
 *   - `key:` with NO continuation — the key is dropped (treated as
 *     unset, not the empty string).
 */
export function parseFrontmatter(
  text: string,
): Record<string, string | undefined> {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*/)
  if (!match) {
    return {}
  }

  const data: Record<string, string | undefined> = {}
  // Tracks the most recent key seen, regardless of whether it has a
  // value yet. A key whose value never gets filled is dropped at the
  // end of the section.
  let pendingKey: string | undefined

  const lines = match[1].split('\n')
  for (let li = 0, { length } = lines; li < length; li += 1) {
    const line = lines[li]
    // Continuation line: starts with whitespace and follows a key.
    if (pendingKey !== undefined && /^\s+/.test(line)) {
      const trimmed = line.trim()
      if (trimmed) {
        const existing = data[pendingKey] ?? ''
        data[pendingKey] = existing ? `${existing} ${trimmed}` : trimmed
      }
      continue
    }

    if (!line.includes(':')) {
      pendingKey = undefined
      continue
    }

    const idx = line.indexOf(':')
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) {
      pendingKey = undefined
      continue
    }
    if (value) {
      // Single-line `key: value`.
      data[key] = value
      pendingKey = undefined
    } else {
      // `key:` — wait to see if continuation lines fill it.
      data[key] = ''
      pendingKey = key
    }
  }

  // Drop keys that never received a value (empty `key:` with no
  // continuation). Keeps `parseFrontmatter('---\nname:\n---').name`
  // → undefined for callers that test with `meta.name && meta.description`.
  const keys = Object.keys(data)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const k = keys[i]
    if (data[k] === '') {
      delete data[k]
    }
  }

  return data
}
