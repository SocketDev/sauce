/*
 * @file Boundary gate: shipped content never exposes fleet scaffolding.
 *   Three assertions, all read-only:
 *
 *   1. Every top-level tracked entry is classified in
 *      scripts/repo/constants/shipped-surfaces.mts (shipped, shipped root file,
 *      or scaffolding) — an unclassified entry fails so new surfaces are a
 *      conscious classification call.
 *   2. No file under a SHIPPED tree mentions a fleet-internal marker (wheelhouse,
 *      fleet hook/doc/script paths).
 *   3. Every plugin `source` in .claude-plugin/marketplace.json resolves inside a
 *      SHIPPED tree — scaffolding is never reachable from a consumer manifest.
 */

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { spawnSync } from '@socketsecurity/lib/process/spawn/child'

import {
  FLEET_INTERNAL_MARKERS,
  SCAFFOLDING_ENTRIES,
  SHIPPED_DIRS,
  SHIPPED_ROOT_FILES,
} from '../constants/shipped-surfaces.mts'

const logger = getDefaultLogger()
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)

export function listTrackedFiles(): string[] {
  const result = spawnSync('git', ['ls-files'], { cwd: ROOT })
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed.\n  Where: ${ROOT}\n  Saw: exit ${result.status}; wanted 0.\n  Fix: run inside the repo checkout.`,
    )
  }
  return result.stdout.split('\n').filter(Boolean)
}

export function findUnclassifiedEntries(tracked: string[]): string[] {
  const classified = new Set<string>([
    ...SHIPPED_DIRS,
    ...SHIPPED_ROOT_FILES,
    ...SCAFFOLDING_ENTRIES,
  ])
  const topLevel = new Set(tracked.map(f => f.split('/')[0]!))
  return [...topLevel].filter(entry => !classified.has(entry)).toSorted()
}

export function findFleetLeaks(tracked: string[]): string[] {
  const leaks: string[] = []
  const shipped = tracked.filter(f =>
    SHIPPED_DIRS.some(dir => f.startsWith(`${dir}/`)),
  )
  for (let i = 0, { length } = shipped; i < length; i += 1) {
    const rel = shipped[i]!
    const content = readFileSync(path.join(ROOT, rel), 'utf-8')
    for (
      let m = 0, markerCount = FLEET_INTERNAL_MARKERS.length;
      m < markerCount;
      m += 1
    ) {
      const marker = FLEET_INTERNAL_MARKERS[m]!
      const idx = content.indexOf(marker)
      if (idx !== -1) {
        const line = content.slice(0, idx).split('\n').length
        leaks.push(`${rel}:${line} mentions "${marker}"`)
      }
    }
  }
  return leaks
}

export function findUnshippedManifestSources(): string[] {
  const manifestPath = path.join(ROOT, '.claude-plugin', 'marketplace.json')
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const manifest = parsed as {
    plugins?:
      | Array<{
          name?: string | undefined
          source?: string | undefined
        }>
      | undefined
  }
  const offenders: string[] = []
  const plugins = manifest.plugins ?? []
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const plugin = plugins[i]!
    const source = plugin.source
    if (!source) {
      continue
    }
    const normalized = source.replace(/^\.\//, '')
    const inShipped = SHIPPED_DIRS.some(
      dir => normalized === dir || normalized.startsWith(`${dir}/`),
    )
    if (!inShipped) {
      offenders.push(`plugin "${plugin.name}" -> ${source}`)
    }
  }
  return offenders
}

function main(): void {
  const tracked = listTrackedFiles()
  const problems: string[] = []

  const unclassified = findUnclassifiedEntries(tracked)
  if (unclassified.length) {
    problems.push(
      `Unclassified top-level entr${unclassified.length === 1 ? 'y' : 'ies'}: ${unclassified.join(', ')}.\n  Fix: classify in scripts/repo/constants/shipped-surfaces.mts (shipped vs scaffolding).`,
    )
  }

  const leaks = findFleetLeaks(tracked)
  if (leaks.length) {
    problems.push(
      `Fleet-internal reference${leaks.length === 1 ? '' : 's'} in shipped content:\n    ${leaks.join('\n    ')}\n  Fix: shipped surfaces teach using Socket only — drop or relocate the reference.`,
    )
  }

  const manifestOffenders = findUnshippedManifestSources()
  if (manifestOffenders.length) {
    problems.push(
      `marketplace.json points outside shipped trees:\n    ${manifestOffenders.join('\n    ')}\n  Fix: plugin sources must live under ${SHIPPED_DIRS.join('/ or ')}/.`,
    )
  }

  if (problems.length) {
    logger.error(
      `shipped-content-is-consumer-clean: ${problems.length} problem(s).`,
    )
    for (let i = 0, { length } = problems; i < length; i += 1) {
      logger.error('')
      logger.error(problems[i]!)
    }
    process.exitCode = 1
    return
  }
  logger.info(
    'shipped-content-is-consumer-clean: OK — boundary holds (classification exhaustive, no fleet leaks, manifest sources shipped).',
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
