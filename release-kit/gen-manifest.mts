/**
 * @file (Re)generate the payload's `kit-manifest.json`: walk the payload,
 *   sha256 every file's POST-FORMAT bytes (R11 — run `pnpm run format`
 *   first, then this), tag channels from the pure mapping in
 *   `install/manifest.mts`, write sorted-by-path. `--check` regenerates in
 *   memory and exits 1 with the four ingredients on drift — sauce's
 *   release-kit-is-coherent check runs the same comparison in the gate.
 *   Usage: node release-kit/gen-manifest.mts [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { isMainModule } from './payload/scripts/socket-release/_shared/is-main-module.mts'
import {
  channelsForPath,
  KIT_VERSION,
  MANIFEST_FILENAME,
} from './install/manifest.mts'
import type { KitManifest } from './install/manifest.mts'
import { PAYLOAD_ROOT, sha256Hex, walkPayload } from './install/seams.mts'

/**
 * Build the manifest from the payload's current bytes.
 */
export function buildManifest(payloadRoot: string = PAYLOAD_ROOT): KitManifest {
  const files = walkPayload(payloadRoot).map(rel => ({
    channels: channelsForPath(rel),
    path: rel,
    sha256: sha256Hex(readFileSync(path.join(payloadRoot, rel))),
  }))
  return { files, kitVersion: KIT_VERSION, schemaVersion: 1 }
}

export function serializeManifest(manifest: KitManifest): string {
  // Match the repo formatter's JSON style so `pnpm run format` is a no-op on
  // the generated file (R11): short leaf arrays — the per-file `channels`
  // lists — collapse to one line. Only bracket-free innermost arrays match,
  // so the long `files` array itself stays expanded.
  const raw = JSON.stringify(manifest, null, 2)
  const collapsed = raw.replace(
    /\[\n\s+([^[\]{}]+?)\n\s+\]/g,
    (_m, inner: string) =>
      `[${inner
        .split(/,\n\s+/)
        .map(s => s.trim())
        .join(', ')}]`,
  )
  return `${collapsed}\n`
}

function main(): void {
  const check = process.argv.includes('--check')
  const manifestPath = path.join(PAYLOAD_ROOT, MANIFEST_FILENAME)
  const manifest = buildManifest()
  const next = serializeManifest(manifest)
  if (check) {
    let current: string | undefined
    try {
      current = readFileSync(manifestPath, 'utf8')
    } catch {
      current = undefined
    }
    if (current !== next) {
      process.stderr.write(
        [
          'Kit manifest is stale: the payload bytes drifted from kit-manifest.json.',
          `  Where: ${manifestPath}`,
          `  Saw: ${current === undefined ? 'no manifest file' : 'sha entries that no longer match the payload'}`,
          '  Wanted: kit-manifest.json regenerated from the current (post-format) payload bytes',
          '  Fix: node release-kit/gen-manifest.mts',
          '',
        ].join('\n'),
      )
      process.exitCode = 1
      return
    }
    process.stdout.write('kit-manifest.json matches the payload bytes.\n')
    return
  }
  writeFileSync(manifestPath, next)
  process.stdout.write(
    `wrote ${manifestPath} (${manifest.files.length} files).\n`,
  )
}

// Entrypoint-guarded so the coherence check can import buildManifest without
// regenerating the manifest as a side effect.
if (isMainModule(import.meta.url)) {
  main()
}
