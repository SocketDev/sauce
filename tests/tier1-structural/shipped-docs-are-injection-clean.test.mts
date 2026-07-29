import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Shipped doc surfaces are exactly the artifact class agents read and obey
 * (SKILL.md, agent instructions). This gate asserts the injection-class
 * patterns documented in real campaigns never ship from this repo:
 * hidden-Unicode runs (zero-width/bidi/Unicode-Tags smuggling), ANSI
 * erase-line concealment, remote-URL npx invocations, and pipe-to-shell
 * install one-liners outside an auditable trusted-prefix allowlist.
 */

import { SHIPPED_DIRS } from '../../scripts/repo/constants/shipped-surfaces.mts'

const ROOT = path.resolve(__dirname, '../..')

const SCANNED_EXTENSIONS = new Set([
  '.json',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.sh',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
])

// Pipe-to-shell is allowed ONLY when the fetched URL starts with one of
// these prefixes. Every entry is a deliberate, reviewed trust decision --
// adding one is a security call, not a formality.
export const TRUSTED_PIPE_TO_SHELL_PREFIXES = [
  // Socket's own installer scripts, served from this org's repos.
  'https://raw.githubusercontent.com/SocketDev/',
  // nvm's documented installer, referenced by the socket-setup skill's
  // Node-version guidance. Pinned-tag URLs only (the version prefix).
  'https://raw.githubusercontent.com/nvm-sh/nvm/v',
] as const

// A run of invisible/direction-control codepoints long enough to smuggle
// content: zero-width (ZWSP/ZWNJ/ZWJ), word-joiner, BOM, bidi embeddings
// and isolates, and the Unicode Tags block. Emoji ZWJ sequences and a lone
// BOM never reach this run length. Escaped codepoints only -- raw invisible
// characters in source are themselves the smuggling shape this test hunts.
const HIDDEN_UNICODE_RUN = new RegExp(
  '[\\u200b-\\u200d\\u2060\\ufeff\\u202a-\\u202e\\u2066-\\u2069\\u{e0000}-\\u{e007f}]{4,}',
  'u',
)

// Erase-line / erase-display sequences and bare carriage returns used to
// hide agent-addressed directives from human readers. The escape byte is
// matched via \x1b so this file contains no raw control characters.
const ANSI_CONCEALMENT = new RegExp('\\x1b\\[[0-9;]*[KJ]|\\r(?!\\n)')

const NPX_REMOTE_URL = /\bnpx\s+https?:\/\//

const PIPE_TO_SHELL =
  /(?:curl|wget)[^\n|]*?(?<url>https?:\/\/\S+)[^\n|]*\|\s*(?:bash|node|python|sh|zsh)\b/g

export function listShippedFiles(): string[] {
  const files: string[] = []
  const stack = SHIPPED_DIRS.map(d => path.join(ROOT, d))
  while (stack.length) {
    const dir = stack.pop()!
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          stack.push(p)
        }
      } else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(p)
      }
    }
  }
  return files.toSorted()
}

describe('Shipped docs are injection-clean', () => {
  const files = listShippedFiles()

  it('scans a non-empty shipped surface', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    describe(rel, () => {
      const content = readFileSync(file, 'utf-8')

      it('has no hidden-Unicode run', () => {
        const m = HIDDEN_UNICODE_RUN.exec(content)
        expect(
          m,
          `${rel} contains a run of invisible/bidi codepoints at index ${m?.index} -- hidden-content smuggling shape`,
        ).toBeNull()
      })

      it('has no ANSI concealment sequence', () => {
        const m = ANSI_CONCEALMENT.exec(content)
        expect(
          m,
          `${rel} contains an erase-line/carriage-return concealment sequence at index ${m?.index}`,
        ).toBeNull()
      })

      it('has no remote-URL npx invocation', () => {
        const m = NPX_REMOTE_URL.exec(content)
        expect(
          m,
          `${rel} invokes npx against a remote URL at index ${m?.index} -- fetch-and-run shape`,
        ).toBeNull()
      })

      it('pipes to shell only from trusted prefixes', () => {
        const offenders: string[] = []
        for (const m of content.matchAll(PIPE_TO_SHELL)) {
          const url = m.groups!['url']!
          const trusted = TRUSTED_PIPE_TO_SHELL_PREFIXES.some(prefix =>
            url.startsWith(prefix),
          )
          if (!trusted) {
            const line = content.slice(0, m.index).split('\n').length
            offenders.push(`line ${line}: ${url}`)
          }
        }
        expect(
          offenders,
          `${rel} pipes untrusted URL(s) into a shell -- add to TRUSTED_PIPE_TO_SHELL_PREFIXES only after review: ${offenders.join('; ')}`,
        ).toEqual([])
      })
    })
  }
})
