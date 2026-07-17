#!/usr/bin/env pnpm dlx tsx
/**
 * Sync the version from package.json into all config files.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

const logger = getDefaultLogger()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface VersionedJson {
  version?: string | undefined
  metadata?: { version?: string | undefined } | undefined
}

export function readJSON<T = VersionedJson>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T
}

export function writeJSON<T>(filePath: string, data: T): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function main(): void {
  const pkg = readJSON(path.join(ROOT, 'package.json'))
  const version = pkg.version
  if (!version) {
    logger.fail('No version field in package.json')
    process.exit(1)
  }

  const targets = [
    path.join(ROOT, '.claude-plugin', 'plugin.json'),
    path.join(ROOT, '.claude-plugin', 'marketplace.json'),
    path.join(ROOT, 'gemini-extension.json'),
  ]

  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    const data = readJSON(target)
    if (target.endsWith('marketplace.json')) {
      data.metadata ??= {}
      data.metadata.version = version
    } else {
      data.version = version
    }
    writeJSON(target, data)
    logger.log(`Synced version ${version} → ${path.relative(ROOT, target)}`)
  }
}

main()
