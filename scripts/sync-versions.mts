#!/usr/bin/env pnpm dlx tsx
/**
 * Sync the version from package.json into all config files.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

export function readJSON(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

export function writeJSON(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function main(): void {
  const pkg = readJSON(path.join(ROOT, 'package.json'))
  const version: string = pkg.version
  if (!version) {
    logger.fail('No version field in package.json')
    process.exit(1)
  }

  const targets = [
    path.join(ROOT, '.claude-plugin', 'plugin.json'),
    path.join(ROOT, '.claude-plugin', 'marketplace.json'),
    path.join(ROOT, 'gemini-extension.json'),
  ]

  for (const target of targets) {
    const data = readJSON(target)
    if (target.endsWith('marketplace.json')) {
      data.metadata.version = version
    } else {
      data.version = version
    }
    writeJSON(target, data)
    logger.log(`Synced version ${version} → ${path.relative(ROOT, target)}`)
  }
}

main()
