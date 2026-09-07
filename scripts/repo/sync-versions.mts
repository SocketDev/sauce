#!/usr/bin/env node
/**
 * Sync the plugin version into marketplace and extension metadata.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'

const logger = getDefaultLogger()

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

interface VersionedJson {
  version?: string | undefined
  metadata?: { version?: string | undefined } | undefined
}

export function readJSON(filePath: string): VersionedJson {
  // Both fields are re-checked with typeof guards at the call sites; a runtime
  // validator for a two-field internal shape would be duplicate.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return JSON.parse(readFileSync(filePath, 'utf-8')) as VersionedJson
}

export function writeJSON(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export function syncPluginVersions(root: string = ROOT): void {
  const source = path.join(root, '.claude-plugin', 'plugin.json')
  const version = readJSON(source).version
  if (typeof version !== 'string' || !version) {
    throw new Error(
      `Plugin version is missing. Where: ${source}. Saw: no nonempty version; wanted the released plugin version. Fix: set the plugin manifest version before syncing.`,
    )
  }

  const targets = [
    path.join(root, '.claude-plugin', 'marketplace.json'),
    path.join(root, 'gemini-extension.json'),
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
    logger.log(`Synced version ${version} → ${path.relative(root, target)}`)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'syncs the plugin version into marketplace and extension metadata',
  help: 'Usage: node scripts/repo/sync-versions.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(syncPluginVersions, SCRIPT_META)
}
