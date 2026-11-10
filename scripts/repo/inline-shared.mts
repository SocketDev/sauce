#!/usr/bin/env `pnpm dlx` tsx
// Nested cached-length for-loops intentionally reuse `i`/`length` names for
// the fleet-wide cached-loop idiom; renaming would diverge from the codebase
// pattern.
/* eslint-disable no-shadow -- cached-loop idiom */
/**
 * Inline shared content into SKILL.md files. Finds markers of the form: <!--
 * BEGIN_SECTION:filename.md --> ... (auto-generated content) ... <!--
 * END_SECTION:filename.md --> and replaces the content between them with the
 * contents of skills/_shared/docs/filename.md. Run as part of the publish
 * pipeline to keep shared sections in sync.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { SHIPPED_INSTRUCTION_DIRS } from './constants/shipped-surfaces.mts'
import { REPO_ROOT } from './paths.mts'
import { ArtifactWriter } from './plugins/output.mts'
import { discoverSkills } from './plugins/skills.mts'
import { isMainModule, runMain } from './util/main.mts'
import type { ScriptMeta } from './util/main.mts'

const logger = getDefaultLogger()

const ROOT = REPO_ROOT
const SHARED_DIR = path.join(ROOT, 'skills', '_shared', 'docs')

/**
 * Every file shared sections are inlined into: each SKILL.md, plus the
 * agent instruction files (Cursor rules) that ship beside the skills.
 */
export function findTargetFiles(root: string = ROOT): string[] {
  const files = discoverSkills(root).map(skill =>
    path.join(skill.dir, 'SKILL.md'),
  )
  for (const dir of SHIPPED_INSTRUCTION_DIRS) {
    const full = path.join(root, dir)
    if (!existsSync(full)) {
      continue
    }
    for (const entry of readdirSync(full).toSorted()) {
      if (entry.endsWith('.md') || entry.endsWith('.mdc')) {
        files.push(path.join(full, entry))
      }
    }
  }
  return files
}

const BEGIN_RE = /^<!-- BEGIN_SECTION:(\S+) -->$/
const END_RE = /^<!-- END_SECTION:(\S+) -->$/

interface Replacement {
  file: string
  section: string
}

/**
 * The file's text with every shared section replaced by the current shared
 * doc, without writing anything.
 */
export function renderInlined(filePath: string): {
  content: string
  replacements: Replacement[]
} {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split(/\r?\n/)
  const output: string[] = []
  const replacements: Replacement[] = []
  let i = 0

  while (i < lines.length) {
    const beginMatch = lines[i]!.match(BEGIN_RE)
    if (!beginMatch) {
      output.push(lines[i]!)
      i++
      continue
    }

    const sectionName = beginMatch[1]!
    output.push(lines[i]!) // keep the BEGIN marker

    // Skip old content until END marker
    i++
    while (i < lines.length) {
      const endMatch = lines[i]!.match(END_RE)
      if (endMatch) {
        if (endMatch[1] !== sectionName) {
          throw new Error(
            `Mismatched section markers in ${filePath}: ` +
              `expected END_SECTION:${sectionName}, got END_SECTION:${endMatch[1]}`,
          )
        }
        break
      }
      i++
    }

    if (i >= lines.length) {
      throw new Error(`Missing END_SECTION:${sectionName} in ${filePath}`)
    }

    // Insert shared content
    const shared = embedBelowCurrentHeading(loadShared(sectionName), output)
    output.push('', shared, '')
    output.push(lines[i]!) // keep the END marker
    replacements.push({
      file: path.relative(ROOT, filePath),
      section: sectionName,
    })
    i++
  }

  return { content: output.join('\n'), replacements }
}

export function loadShared(name: string): string {
  const filePath = path.join(SHARED_DIR, name)
  if (!existsSync(filePath)) {
    throw new Error(`Shared file not found: ${filePath}`)
  }
  return readFileSync(filePath, 'utf-8').trimEnd()
}

function embedBelowCurrentHeading(shared: string, output: string[]): string {
  let parentDepth = 0
  for (let i = output.length - 1; i >= 0; i -= 1) {
    const heading = output[i]!.match(/^(#{1,6})\s/u)
    if (heading) {
      parentDepth = heading[1]!.length
      break
    }
  }
  if (parentDepth === 0) {
    return shared
  }

  let inFence = false
  return shared
    .split(/\r?\n/)
    .map(line => {
      if (/^(?:```|~~~)/u.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) {
        return line
      }
      // Capture the Markdown heading markers, then their required separating
      // whitespace; the replacement only increases the marker depth.
      return line.replace(
        /^(#{1,6})(\s)/u,
        (_match, hashes, space) =>
          `${'#'.repeat(Math.min(6, parentDepth + hashes.length))}${space}`,
      )
    })
    .join('\n')
}

function main(): void {
  const checkMode = process.argv.includes('--check')
  const files = findTargetFiles()
  const out = new ArtifactWriter(ROOT, checkMode)
  let total = 0
  for (const file of files) {
    const { content, replacements } = renderInlined(file)
    out.file(path.relative(ROOT, file).split(path.sep).join('/'), content)
    total += replacements.length
    if (!checkMode) {
      for (const r of replacements) {
        logger.log(`  ${r.file}: inlined ${r.section}`)
      }
    }
  }
  const { outdated } = out.report()
  if (checkMode && outdated.length > 0) {
    logger.fail('Shared sections are out of date:')
    for (const f of outdated) {
      logger.fail(`  - ${f}`)
    }
    logger.fail('Run: pnpm run generate')
    process.exitCode = 1
    return
  }
  logger.log(
    checkMode
      ? `Shared sections are up to date (${total} sections in ${files.length} files).`
      : `Inlined ${total} shared sections across ${files.length} files.`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe: 'inlines shared documentation sections into skill files',
  help: `Usage: node scripts/repo/inline-shared.mts [--check]
  --check    Verify shared sections without writing`,
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
