import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { getSkillMarkdownFiles } from './skill-path-portability.test.mts'

const ROOT = path.resolve(__dirname, '../..')
const SKILLS_DIR = path.join(ROOT, 'skills')
const SHARED_DOCS_DIR = path.join(SKILLS_DIR, '_shared', 'docs')

/**
 * Commands that no longer exist in the tools this repo documents.
 */
const RETIRED_COMMANDS = [
  {
    re: /(?<![\w-])pnpx(?![\w-])/,
    saw: 'pnpx',
    fix: 'use `pnpm dlx` — the name every current pnpm release documents, and the one this repo already uses everywhere else',
  },
  {
    re: /(?<![\w-])npm\s+bin\s+(?:--global|-g)(?![\w-])/,
    saw: 'npm bin -g',
    fix: 'use `npm prefix -g` and append `/bin` on macOS and Linux — `npm bin` was removed in npm 9, so this fails on every Node these skills support',
  },
]

/**
 * The sentence a skill prints when it tells the reader every Socket CLI call
 * carries the `pnpm dlx` prefix. A skill that makes this promise has to keep
 * it.
 */
const DLX_PREFIX_PROMISE =
  'All commands in this skill use the `pnpm dlx socket` prefix'

/**
 * Fence opening or closing line.
 */
const FENCE_RE = /^\s*(?:```|~~~)/

/**
 * Inline code span, capturing the content between the backticks.
 */
const INLINE_CODE_RE = /`(?<code>[^`\n]+)`/g

/**
 * A markdown table delimiter cell, e.g. `---`, `:--`, `--:`, `:-:`.
 */
const DELIMITER_CELL_RE = /^:?-+:?$/

/**
 * A Socket CLI invocation that is missing its `pnpm dlx` prefix.
 */
const BARE_SOCKET_CALL_RE = /^socket\s+[a-z][\w-]*(?:\s|$)/

export interface DocTable {
  /**
   * 1-based line number of the header row.
   */
  line: number
  rows: Array<{ line: number; cells: string[] }>
}

/**
 * Every human-facing markdown document this repo publishes.
 * `docs/agents-template.md` is deliberately absent: its `{{#skills}}` marker
 * rows are not table rows, and its rendered output, `agents/README.md`, is
 * checked here instead.
 */
export function getLintedDocs(): string[] {
  const docs = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'agents', 'README.md'),
    ...getSkillMarkdownFiles(SKILLS_DIR),
  ]
  const sharedDocs = readdirSync(SHARED_DOCS_DIR)
    .filter(name => name.endsWith('.md'))
    .toSorted()
  for (let i = 0, { length } = sharedDocs; i < length; i += 1) {
    docs.push(path.join(SHARED_DOCS_DIR, sharedDocs[i]!))
  }
  return docs.filter(doc => existsSync(doc))
}

/**
 * Split a table row the way a markdown renderer does: on every `|` that is not
 * backslash-escaped. An unescaped `|` inside a code span still splits the cell,
 * which is exactly the mistake this parser has to reproduce to catch it.
 */
export function readTableCells(line: string): string[] {
  const cells: string[] = []
  let current = ''
  const trimmed = line.trim()
  for (let i = 0, { length } = trimmed; i < length; i += 1) {
    const char = trimmed[i]!
    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '\\|'
      i += 1
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  // A row written with leading and trailing pipes yields an empty cell at each
  // end; drop those so the count reflects the rendered columns.
  if (cells.length > 1 && cells[0]!.trim() === '') {
    cells.shift()
  }
  if (cells.length > 1 && cells[cells.length - 1]!.trim() === '') {
    cells.pop()
  }
  return cells.map(cell => cell.trim())
}

/**
 * Every table in the document, ignoring anything inside a code fence.
 */
export function readTables(content: string): DocTable[] {
  const lines = content.split('\n')
  const tables: DocTable[] = []
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      i += 1
      continue
    }
    if (inFence || !line.trim().startsWith('|')) {
      i += 1
      continue
    }
    const rows: Array<{ line: number; cells: string[] }> = []
    while (i < lines.length && lines[i]!.trim().startsWith('|')) {
      rows.push({ line: i + 1, cells: readTableCells(lines[i]!) })
      i += 1
    }
    if (rows.length >= 2) {
      tables.push({ line: rows[0]!.line, rows })
    }
  }
  return tables
}

/**
 * Command strings a reader is meant to run, drawn from fences and code spans.
 */
export function readRunnableCommands(
  content: string,
): Array<{ line: number; text: string }> {
  const commands: Array<{ line: number; text: string }> = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      const text = line.trim().replace(/^\$\s+/, '')
      if (text && !text.startsWith('#')) {
        commands.push({ line: i + 1, text })
      }
      continue
    }
    for (const match of line.matchAll(INLINE_CODE_RE)) {
      // An inline span naming the tool alone ("`socket fix`") reads as prose;
      // a span carrying arguments reads as a command to run.
      const text = match.groups!['code']!.trim()
      if (text.split(/\s+/).length >= 3) {
        commands.push({ line: i + 1, text })
      }
    }
  }
  return commands
}

describe('Doc Command Lint', () => {
  const docs = getLintedDocs()

  for (let i = 0, { length } = docs; i < length; i += 1) {
    const doc = docs[i]!
    const relDoc = path.relative(ROOT, doc)

    describe(relDoc, () => {
      const content = readFileSync(doc, 'utf-8')

      it('names no retired package-manager command', () => {
        const lines = content.split('\n')
        const hits: string[] = []
        for (let j = 0, lineCount = lines.length; j < lineCount; j += 1) {
          for (
            let k = 0, ruleCount = RETIRED_COMMANDS.length;
            k < ruleCount;
            k += 1
          ) {
            const rule = RETIRED_COMMANDS[k]!
            if (rule.re.test(lines[j]!)) {
              hits.push(`${relDoc}:${j + 1} saw \`${rule.saw}\` — ${rule.fix}`)
            }
          }
        }
        expect(
          hits,
          `${relDoc} prescribes ${hits.length} command(s) that the named tool no longer has:\n` +
            hits.map(hit => `  - ${hit}`).join('\n'),
        ).toEqual([])
      })

      it('every table renders as a table', () => {
        const tables = readTables(content)
        const problems: string[] = []
        for (let j = 0, tableCount = tables.length; j < tableCount; j += 1) {
          const table = tables[j]!
          const header = table.rows[0]!
          const delimiter = table.rows[1]!
          const isDelimiter =
            delimiter.cells.length > 0 &&
            delimiter.cells.every(cell => DELIMITER_CELL_RE.test(cell))
          if (!isDelimiter) {
            continue
          }
          if (delimiter.cells.length !== header.cells.length) {
            problems.push(
              `${relDoc}:${delimiter.line} the delimiter row has ` +
                `${delimiter.cells.length} cell(s) under a ` +
                `${header.cells.length}-column header, so the whole block ` +
                `renders as plain text instead of a table`,
            )
            continue
          }
          for (let k = 2, rowCount = table.rows.length; k < rowCount; k += 1) {
            const row = table.rows[k]!
            if (row.cells.length !== header.cells.length) {
              problems.push(
                `${relDoc}:${row.line} the row has ${row.cells.length} ` +
                  `cell(s) in a ${header.cells.length}-column table — an ` +
                  `unescaped \`|\` inside a cell splits it, so write it as \`\\|\``,
              )
            }
          }
        }
        expect(
          problems,
          `${relDoc} has ${problems.length} malformed table row(s):\n` +
            problems.map(problem => `  - ${problem}`).join('\n'),
        ).toEqual([])
      })

      it('keeps the `pnpm dlx socket` prefix it promises', () => {
        if (!content.includes(DLX_PREFIX_PROMISE)) {
          return
        }
        const commands = readRunnableCommands(content)
        const bare: string[] = []
        for (
          let j = 0, commandCount = commands.length;
          j < commandCount;
          j += 1
        ) {
          const command = commands[j]!
          if (BARE_SOCKET_CALL_RE.test(command.text)) {
            bare.push(`${relDoc}:${command.line} \`${command.text}\``)
          }
        }
        expect(
          bare,
          `${relDoc} tells the reader that every Socket CLI call uses the ` +
            `\`pnpm dlx socket\` prefix, then gives ${bare.length} call(s) without it:\n` +
            bare.map(hit => `  - ${hit}`).join('\n') +
            `\n  A reader who took the no-global-install path gets ` +
            `\`socket: command not found\`. Prefix each call with \`pnpm dlx\`.`,
        ).toEqual([])
      })
    })
  }
})
