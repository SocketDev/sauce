// socket-lint: mirror-exempt — asserts every path a shipped doc names resolves for a consumer, so the shipped tree is the subject, not a module.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const SKILLS_DIR = path.join(REPO_ROOT, 'skills')
const SHARED_DOCS_DIR = path.join(SKILLS_DIR, '_shared', 'docs')

/**
 * A path-like token is a run of path characters holding at least one `/`.
 * The character class deliberately omits `:` and `*` so URLs and globs fall
 * apart into fragments that resolve to nothing.
 */
const PATH_TOKEN_RE = /[\w@.~/-]*\/[\w@.~/-]+/g

/**
 * Fenced code block, capturing the body between the fences.
 */
const FENCED_BLOCK_RE =
  /^(?:```|~~~)[^\n]*\n(?<body>[\s\S]*?)^(?:```|~~~)\s*$/gm

/**
 * Inline code span, capturing the content between the backticks.
 */
const INLINE_CODE_RE = /`(?<code>[^`\n]+)`/g

/**
 * Directories that exist in a consumer's project under exactly these names, so
 * a token starting with one names the consumer's file rather than this repo's —
 * even when this repo happens to hold a file at the same path.
 */
const CONSUMER_PROJECT_PREFIXES = [
  '.circleci/',
  '.github/',
  '.gitlab/',
  '.socket/',
  '.vscode/',
  'node_modules/',
]

/**
 * Every markdown document a consumer receives when they install a skill,
 * paired with the folder that ships alongside it.
 */
export function getPortableDocs(): Array<{ file: string; owningDir: string }> {
  const docs: Array<{ file: string; owningDir: string }> = []
  const skillMds = getSkillMarkdownFiles(SKILLS_DIR)
  for (let i = 0, { length } = skillMds; i < length; i += 1) {
    const file = skillMds[i]!
    docs.push({ file, owningDir: path.dirname(file) })
  }
  const sharedDocs = readdirSync(SHARED_DOCS_DIR)
    .filter(name => name.endsWith('.md'))
    .toSorted()
  for (let i = 0, { length } = sharedDocs; i < length; i += 1) {
    docs.push({
      file: path.join(SHARED_DOCS_DIR, sharedDocs[i]!),
      owningDir: SHARED_DOCS_DIR,
    })
  }
  return docs
}

/**
 * Every SKILL.md under `dir`, including subskills.
 */
export function getSkillMarkdownFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue
    }
    const full = path.join(dir, entry.name)
    const skillMd = path.join(full, 'SKILL.md')
    if (existsSync(skillMd)) {
      results.push(skillMd)
    }
    results.push(...getSkillMarkdownFiles(full))
  }
  return results
}

/**
 * Path-like tokens found in the document's code fences and inline code spans.
 * Prose is excluded: only text an agent is liable to execute or open counts.
 */
export function readPathTokens(content: string): string[] {
  const tokens: string[] = []
  const snippets: string[] = []
  for (const match of content.matchAll(FENCED_BLOCK_RE)) {
    snippets.push(match.groups!['body']!)
  }
  for (const match of content.matchAll(INLINE_CODE_RE)) {
    snippets.push(match.groups!['code']!)
  }
  for (let i = 0, { length } = snippets; i < length; i += 1) {
    const found = snippets[i]!.match(PATH_TOKEN_RE)
    if (found) {
      tokens.push(...found)
    }
  }
  return tokens
}

/**
 * Resolve a token against the repo root, or `undefined` when the token cannot
 * name a repo-internal file (absolute path, home-relative path, npm scope,
 * directory, or a path that escapes the repo).
 */
export function resolveRepoFile(token: string): string | undefined {
  if (
    token.startsWith('/') ||
    token.startsWith('~') ||
    token.startsWith('@') ||
    token.endsWith('/')
  ) {
    return undefined
  }
  for (let i = 0, { length } = CONSUMER_PROJECT_PREFIXES; i < length; i += 1) {
    if (token.startsWith(CONSUMER_PROJECT_PREFIXES[i]!)) {
      return undefined
    }
  }
  const resolved = path.resolve(REPO_ROOT, token)
  if (
    resolved !== REPO_ROOT &&
    !resolved.startsWith(`${REPO_ROOT}${path.sep}`)
  ) {
    return undefined
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return undefined
  }
  return resolved
}

describe('Skill Path Portability', () => {
  const docs = getPortableDocs()

  for (let i = 0, { length } = docs; i < length; i += 1) {
    const { file, owningDir } = docs[i]!
    const relFile = path.relative(REPO_ROOT, file)

    it(`${relFile} references no file outside its own folder`, () => {
      const content = readFileSync(file, 'utf-8')
      const tokens = readPathTokens(content)
      const escapes: string[] = []

      for (let j = 0, tokenCount = tokens.length; j < tokenCount; j += 1) {
        const token = tokens[j]!
        const resolved = resolveRepoFile(token)
        if (!resolved) {
          continue
        }
        if (resolved.startsWith(`${owningDir}${path.sep}`)) {
          continue
        }
        escapes.push(token)
      }

      expect(
        [...new Set(escapes)].toSorted(),
        `${relFile} references ${escapes.length} path(s) that live outside ` +
          `${path.relative(REPO_ROOT, owningDir)}.\n` +
          `  Where: ${relFile}\n` +
          `  Saw:   ${[...new Set(escapes)].toSorted().join(', ')}\n` +
          `         (wanted: only paths inside the folder that ships with the skill)\n` +
          `  Why:   a skill folder installs on its own into someone else's ` +
          `project, and the agent runs with THAT project as its working ` +
          `directory. A path into this repository resolves to nothing there.\n` +
          `  Fix:   replace the reference with a command that needs no file ` +
          `from this repository, or inline the content it points at.`,
      ).toEqual([])
    })
  }
})
