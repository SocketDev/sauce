/**
 * @file The installer's filesystem effects, behind `InstallSeams` so the
 *   pure planner never sees fs. Walking, hashing, reading the target's
 *   current shas, copying payload files, and the write-only-if-absent
 *   consumer config seed all live here.
 */

import crypto from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PAYLOAD_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'payload',
  'scripts',
  'socket-release',
)

/**
 * Where the kit installs inside a consumer.
 */
export const INSTALL_PREFIX = 'scripts/socket-release'

export interface InstallSeams {
  copyFile(rel: string, targetRoot: string): void
  hashTargetFile(rel: string, targetRoot: string): string | undefined
  readPayloadFile(rel: string): string | undefined
  targetFileExists(p: string): boolean
  writeTargetFile(p: string, content: string): void
}

/**
 * Read the target's current sha for every entry path — the planner's
 * `targetReads` input.
 */
export function readTargetShas(
  seams: InstallSeams,
  paths: readonly string[],
  targetRoot: string,
): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>()
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const rel = paths[i]!
    map.set(rel, seams.hashTargetFile(rel, targetRoot))
  }
  return map
}

/**
 * The real installer seams against a payload root.
 */
export function resolveInstallSeams(
  payloadRoot: string = PAYLOAD_ROOT,
): InstallSeams {
  return {
    copyFile: (rel, targetRoot) => {
      const from = path.join(payloadRoot, rel)
      const to = path.join(targetRoot, INSTALL_PREFIX, rel)
      mkdirSync(path.dirname(to), { recursive: true })
      copyFileSync(from, to)
    },
    hashTargetFile: (rel, targetRoot) => {
      const p = path.join(targetRoot, INSTALL_PREFIX, rel)
      try {
        return sha256Hex(readFileSync(p))
      } catch {
        return undefined
      }
    },
    readPayloadFile: rel => {
      try {
        return readFileSync(path.join(payloadRoot, rel), 'utf8')
      } catch {
        return undefined
      }
    },
    targetFileExists: p => existsSync(p),
    writeTargetFile: (p, content) => {
      mkdirSync(path.dirname(p), { recursive: true })
      writeFileSync(p, content)
    },
  }
}

export function sha256Hex(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Every payload-relative file path, sorted, excluding the manifest itself.
 */
export function walkPayload(root: string = PAYLOAD_ROOT): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        files.push(path.relative(root, full).replaceAll('\\', '/'))
      }
    }
  }
  walk(root)
  return files
    .filter(f => f !== 'kit-manifest.json')
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
