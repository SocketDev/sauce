/**
 * Helpers the plugin targets use to read what an agent CLI reports after it
 * loads the plugin. The runner lives in load-check.mts.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parseFrontmatter } from '../lib/frontmatter.mts'

/**
 * Parses the first JSON block in CLI output, skipping log lines around it,
 * including ones that start with a bracket.
 */
export function parseJsonOutput(output: string): unknown {
  const lines = output.split('\n')
  for (let start = 0; start < lines.length; start += 1) {
    if (!/^[[{]/.test(lines[start]!)) {
      continue
    }
    for (let end = lines.length; end > start; end -= 1) {
      try {
        return JSON.parse(lines.slice(start, end).join('\n'))
      } catch {}
    }
  }
  throw new Error(`Expected JSON output, got:\n${output.slice(0, 500)}`)
}

/**
 * Every http(s) URL string anywhere in a JSON value.
 */
export function collectUrls(value: unknown): string[] {
  const urls: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (/^https?:\/\//.test(node)) {
        urls.push(node)
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
    } else if (node && typeof node === 'object') {
      for (const item of Object.values(node)) {
        visit(item)
      }
    }
  }
  visit(value)
  return urls
}

/**
 * The names of the skills (SKILL.md files) under a directory, as an agent that
 * copied the plugin there would find them, up to `maxDepth` levels down.
 */
export function findSkillNames(dir: string, maxDepth = 8): string[] {
  const names: string[] = []
  const walk = (current: string, depth: number): void => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isFile() && entry.name === 'SKILL.md') {
        const { name } = parseFrontmatter(readFileSync(full, 'utf-8'))
        names.push(name ?? path.basename(current))
      } else if (
        entry.isDirectory() &&
        depth < maxDepth &&
        entry.name !== '.git' &&
        entry.name !== 'node_modules'
      ) {
        walk(full, depth + 1)
      }
    }
  }
  walk(dir, 0)
  return [...new Set(names)].toSorted()
}

/**
 * Reads a JSON file from the plugin build.
 */
export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
}
