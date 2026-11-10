/**
 * The one way plugin targets write files. A target describes what each
 * output should contain; ArtifactWriter compares it with what is on disk,
 * and either writes it or (in check mode) records it as outdated. Targets
 * never touch the filesystem directly.
 */

import crypto from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import * as path from 'node:path'

import { sortedEntries, symlinkError } from './skills.mts'

export const MISSING = '__MISSING__'

export interface ArtifactReport {
  /**
   * Repo-relative paths whose content differs from what was generated.
   */
  outdated: string[]
  /**
   * Repo-relative paths removed because nothing generates them anymore.
   */
  removed: string[]
}

export class ArtifactWriter {
  readonly root: string
  readonly check: boolean
  readonly outdated: string[] = []
  readonly removed: string[] = []

  constructor(root: string, check: boolean) {
    this.root = root
    this.check = check
  }

  /**
   * Write a JSON file formatted the way the repository formatter does.
   */
  json(relPath: string, data: unknown): void {
    this.file(relPath, renderFormattedJson(data))
  }

  file(
    relPath: string,
    content: string | Buffer,
    options?: { executable?: boolean | undefined } | undefined,
  ): void {
    const target = this.abs(relPath)
    const buffer = typeof content === 'string' ? Buffer.from(content) : content
    const executable = options?.executable === true
    if (isUpToDate(target, buffer, executable)) {
      return
    }
    if (this.check) {
      this.outdated.push(relPath)
      return
    }
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, buffer)
    if (process.platform !== 'win32') {
      const mode = statSync(target).mode & 0o777
      chmodSync(target, executable ? mode | 0o111 : mode & ~0o111)
    }
  }

  /**
   * Make relDir hold exactly `files` (keyed by path relative to relDir,
   * '/'-separated, valued by source path), copied byte for byte with their
   * executable bit. Files nothing generates are removed first, so a
   * case-only rename on a case-insensitive filesystem is rewritten rather
   * than deleted.
   */
  tree(relDir: string, files: ReadonlyMap<string, string>): void {
    const dir = this.abs(relDir)
    if (existsSync(dir)) {
      for (const { 0: rel, 1: target } of listFiles(dir)) {
        if (files.has(rel)) {
          continue
        }
        const relToRoot = `${relDir}/${rel}`
        if (this.check) {
          this.outdated.push(relToRoot)
        } else {
          unlinkSync(target)
          this.removed.push(relToRoot)
        }
      }
    }
    for (const { 0: rel, 1: source } of files) {
      this.file(`${relDir}/${rel}`, readFileSync(source), {
        executable: isExecutable(source),
      })
    }
    if (!this.check && existsSync(dir)) {
      removeEmptyDirs(dir, dir)
    }
  }

  /**
   * Report, never delete, entries in relDir other than `allowed`.
   */
  onlyEntries(relDir: string, allowed: readonly string[]): void {
    const dir = this.abs(relDir)
    if (!existsSync(dir)) {
      return
    }
    for (const entry of readdirSync(dir).toSorted()) {
      if (!allowed.includes(entry)) {
        this.outdated.push(`${relDir}/${entry}`)
      }
    }
  }

  report(): ArtifactReport {
    return { outdated: [...this.outdated], removed: [...this.removed] }
  }

  private abs(relPath: string): string {
    return path.join(this.root, ...relPath.split('/'))
  }
}

/**
 * Hash a directory's file paths and contents, so a check can tell whether
 * anything in it was added, changed, or removed. Empty directories do not
 * count.
 */
export function treeSignature(dir: string): string {
  if (!existsSync(dir)) {
    return MISSING
  }
  const hash = crypto.createHash('sha256')
  for (const { 0: rel, 1: file } of listFiles(dir)) {
    hash.update(`${rel}\0`)
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Serialize JSON byte-identically to the repo formatter (oxfmt, printWidth
 * 80): objects always break one key per line; an array of primitives stays
 * on one line when that line, including any trailing comma, fits the width.
 */
export function renderFormattedJson(data: unknown): string {
  return `${renderValue(data, '', '', '')}\n`
}

const PRINT_WIDTH = 80

function renderValue(
  value: unknown,
  indent: string,
  prefix: string,
  suffix: string,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }
    const primitive = value.every(v => v === null || typeof v !== 'object')
    if (primitive) {
      const inline = `[${value.map(v => JSON.stringify(v)).join(', ')}]`
      if ((indent + prefix + inline + suffix).length <= PRINT_WIDTH) {
        return inline
      }
    }
    const inner = `${indent}  `
    const items = value.map(
      (v, i) =>
        inner + renderValue(v, inner, '', i < value.length - 1 ? ',' : ''),
    )
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(({ 1: v }) => v !== undefined)
    if (entries.length === 0) {
      return '{}'
    }
    const inner = `${indent}  `
    const lines = entries.map(([key, v], i) => {
      const keyPrefix = `${JSON.stringify(key)}: `
      const comma = i < entries.length - 1 ? ',' : ''
      return inner + keyPrefix + renderValue(v, inner, keyPrefix, comma)
    })
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

function isExecutable(file: string): boolean {
  return (statSync(file).mode & 0o111) !== 0
}

function isUpToDate(
  target: string,
  content: Buffer,
  executable: boolean,
): boolean {
  if (!existsSync(target)) {
    return false
  }
  if (!readFileSync(target).equals(content)) {
    return false
  }
  return process.platform === 'win32' || isExecutable(target) === executable
}

/**
 * Every file under dir, keyed by '/'-separated relative path.
 */
function listFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (current: string, prefix: string): void => {
    for (const entry of sortedEntries(current)) {
      const full = path.join(current, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        throw symlinkError(full)
      }
      if (entry.isDirectory()) {
        walk(full, rel)
      } else if (entry.isFile()) {
        out.set(rel, full)
      }
    }
  }
  walk(dir, '')
  return out
}

function removeEmptyDirs(dir: string, keep: string): boolean {
  let empty = true
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!removeEmptyDirs(path.join(dir, entry.name), keep)) {
        empty = false
      }
    } else {
      empty = false
    }
  }
  if (empty && dir !== keep) {
    rmdirSync(dir)
  }
  return empty
}
