#!/usr/bin/env pnpm dlx tsx
/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * Inline shared content into SKILL.md files. Finds markers of the form: <!--
 * BEGIN_SECTION:filename.md --> ... (auto-generated content) ... <!--
 * END_SECTION:filename.md --> and replaces the content between them with the
 * contents of skills/_shared/filename.md. Run as part of the publish pipeline
 * to keep shared sections in sync.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

const logger = getDefaultLogger()

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
const SKILLS_DIR = path.join(ROOT, 'skills')
const SHARED_DIR = path.join(SKILLS_DIR, '_shared')

const BEGIN_RE = /^<!-- BEGIN_SECTION:(\S+) -->$/
const END_RE = /^<!-- END_SECTION:(\S+) -->$/

interface Replacement {
  file: string
  section: string
}

export function findSkillFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry.name.startsWith('_')) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const skillMd = path.join(full, 'SKILL.md')
      if (existsSync(skillMd)) {
        results.push(skillMd)
      }
      // Recurse for subskills
      results.push(...findSkillFiles(full))
    }
  }
  return results
}

export function inlineShared(filePath: string): Replacement[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
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
    output.push('', shared)
    output.push(lines[i]!) // keep the END marker
    replacements.push({
      file: path.relative(ROOT, filePath),
      section: sectionName,
    })
    i++
  }

  const newContent = output.join('\n')
  if (newContent !== content) {
    writeFileSync(filePath, newContent, 'utf-8')
  }

  return replacements
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
    .split('\n')
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
  const files = findSkillFiles(SKILLS_DIR)
  let totalReplacements = 0
  const outdated: string[] = []

  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (checkMode) {
      // Read content, compute what it should be, compare
      const original = readFileSync(file, 'utf-8')
      const replacements = inlineShared(file)
      const updated = readFileSync(file, 'utf-8')
      if (original !== updated) {
        outdated.push(path.relative(ROOT, file))
        // Restore original for check mode
        writeFileSync(file, original, 'utf-8')
      }
      totalReplacements += replacements.length
    } else {
      const replacements = inlineShared(file)
      for (let i = 0, { length } = replacements; i < length; i += 1) {
        const r = replacements[i]!
        logger.log(`  ${r.file}: inlined ${r.section}`)
      }
      totalReplacements += replacements.length
    }
  }

  if (checkMode) {
    if (outdated.length > 0) {
      logger.fail('Shared sections are out of date:')
      for (let i = 0, { length } = outdated; i < length; i += 1) {
        const f = outdated[i]!
        logger.fail(`  - ${f}`)
      }
      logger.fail('Run: pnpm exec tsx scripts/repo/inline-shared.ts')
      process.exit(1)
    }
    logger.log(
      `Shared sections are up to date (${totalReplacements} sections in ${files.length} files).`,
    )
  } else {
    logger.log(
      `Inlined ${totalReplacements} shared sections across ${files.length} files.`,
    )
  }
}

main()
