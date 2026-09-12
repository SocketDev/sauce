import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs/safe'

import { logger, rootPath, runCapture } from '../shared.mts'
import { collectThreatFailures } from './threat-scan.mts'
import type { runLocalThreatScan, ThreatManifest } from './threat-scan.mts'

// Extract the tarball and run the keyless local threat scan over its `package/`
// root. Returns true only when the scan ran AND every file triaged clean.
// Fails closed (returns false) on a blocking verdict, an extraction failure, or
// `available:false` — the scan was explicitly requested, so a missing local
// model must not read as a pass. The extract dir is always cleaned.
export async function runThreatScanLeg(
  tarballPath: string,
  entry: { name: string; version: string },
  runThreat: typeof runLocalThreatScan,
): Promise<boolean> {
  const { name, version } = entry
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-threat-'))
  try {
    const untar = await runCapture(
      'tar',
      ['-xzf', tarballPath, '-C', dir],
      rootPath,
    )
    if (untar.code !== 0) {
      logger.fail(
        `Threat scan: extracting ${name}@${version} failed (tar exited ${untar.code}); not approving.`,
      )
      return false
    }
    const packageDir = path.join(dir, 'package')
    let manifest: ThreatManifest = {}
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
      manifest = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
      ) as ThreatManifest
    } catch {
      // A tarball with no readable package.json still gets a code scan; the
      // manifest only refines file prioritization.
    }
    const result = await runThreat(packageDir, { manifest })
    if (!result.available) {
      logger.fail(
        `Threat scan: requested (--threat-scan) but no on-device model resolved for ${name}@${version}; ` +
          'failing closed. Provision a local backend (ODAI_BACKEND / node:smol-ai / llama-server) or drop --threat-scan.',
      )
      return false
    }
    const failing = collectThreatFailures(result.findings)
    if (failing.length > 0) {
      logger.fail(
        `Threat scan: ${failing.length} threat finding(s) for ${name}@${version}; not approving.`,
      )
      for (let i = 0, { length } = failing; i < length; i += 1) {
        const f = failing[i]!
        logger.fail(
          `  - ${f.verdict} (${f.confidence}) ${f.file}: ${f.reasons.join('; ')}`,
        )
      }
      return false
    }
    logger.log(
      `Threat scan: ${result.findings.length} file(s) triaged clean for ${name}@${version}.`,
    )
    return true
  } finally {
    await safeDelete(dir)
  }
}
