import { promises as fs, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { tarExecutable } from '../../_shared/tar-executable.mts'
import { logger, runCapture } from '../shared.mts'
import { requiredPayloadFiles } from './workspace-plan.mts'

import type { StageListEntry } from './shared.mts'
import type { WorkspacePackage } from './workspace.mts'

/**
 * Approve-time verify for a GENERATED PLATFORM package. Its prebuilt payload
 * comes from the CI build matrix, so a local re-pack can never byte-match the
 * staged tarball (the local checkout has no — or a differently-built — .node
 * binary); the byte-compare gate (verifyStagedEntry) is the wrong axis here.
 * The honest axis is STRUCTURAL, on the staged bytes themselves: download the
 * staged tarball, and require (1) its manifest names exactly
 * `entry.name@entry.version` and (2) every declared payload file (literal
 * `files` entries + `main`) present AND non-empty inside it — a hollow
 * platform tarball never reaches the approve prompt. Fails LOUD and returns
 * false on any missing evidence. `downloadStagedTarball` is injected by the
 * caller, approve passes the stage-download helper — also the test dependency.
 */
export async function verifyStagedPlatformEntry(
  entry: StageListEntry,
  pkg: WorkspacePackage,
  options?:
    | {
        downloadStagedTarball?:
          | ((stageId: string) => Promise<string | undefined>)
          | undefined
      }
    | undefined,
): Promise<boolean> {
  const { downloadStagedTarball } = { __proto__: null, ...options } as {
    downloadStagedTarball?:
      | ((stageId: string) => Promise<string | undefined>)
      | undefined
  }
  const { name, stageId, version } = entry
  if (!name || !version || !stageId || !downloadStagedTarball) {
    logger.fail(
      `Pre-approve verify: staged platform entry is missing ` +
        `name/version/stageId (or no downloader was supplied).\n` +
        `  Where: ${JSON.stringify(entry)}\n` +
        `  Fix: re-stage the package; do not approve an entry the registry ` +
        `can't identify.`,
    )
    return false
  }
  const tarballPath = await downloadStagedTarball(stageId)
  if (!tarballPath) {
    logger.fail(
      `Pre-approve verify FAILED for ${name}@${version}.\n` +
        `  Where: the staged tarball could not be downloaded (stageId ` +
        `${stageId}) — a platform package verifies on the STAGED bytes (its ` +
        `CI-built payload has no local twin to byte-compare).\n` +
        `  Fix: check npm auth (pnpm stage download ${stageId}), or reject + ` +
        `re-stage. Not approving unverified bytes.`,
    )
    return false
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-platform-'))
  try {
    const untar = await runCapture(
      tarExecutable(),
      ['-xzf', tarballPath, '-C', tmpDir],
      tmpDir,
    )
    if (untar.code !== 0) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}: extracting the ` +
          `staged tarball failed (tar exited ${untar.code}).`,
      )
      return false
    }
    const packageDir = path.join(tmpDir, 'package')
    let staged: { name?: unknown | undefined; version?: unknown | undefined }
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
      staged = JSON.parse(
        readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
      ) as typeof staged
    } catch {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}: the staged ` +
          `tarball carries no readable package.json.`,
      )
      return false
    }
    if (staged.name !== name || staged.version !== version) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}.\n` +
          `  Saw vs wanted: the staged tarball's manifest reads ` +
          `${String(staged.name)}@${String(staged.version)}; wanted ` +
          `${name}@${version}.\n` +
          `  Fix: reject the staged publish (node scripts/socket-release/npm-web-auth.mts stage reject ${stageId}) ` +
          `and re-stage.`,
      )
      return false
    }
    const hollow: string[] = []
    const payload = requiredPayloadFiles(pkg.manifest)
    for (let i = 0, { length } = payload; i < length; i += 1) {
      const rel = payload[i]!
      const filePath = path.join(packageDir, rel)
      let size = -1
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- the SIZE is the point: a zero-byte payload is as hollow as a missing one.
        size = statSync(filePath).size
      } catch {
        // Missing file — recorded below.
      }
      if (size <= 0) {
        hollow.push(rel)
      }
    }
    if (hollow.length > 0) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}: the staged ` +
          `tarball is HOLLOW.\n` +
          `  Saw vs wanted: missing/empty payload file(s) ` +
          `${hollow.join(', ')}; wanted every declared platform payload ` +
          `present and non-empty.\n` +
          `  Fix: reject the staged publish (node scripts/socket-release/npm-web-auth.mts stage reject ${stageId}) ` +
          `and re-stage from a CI run whose build artifacts landed.`,
      )
      return false
    }
    logger.success(
      `Verified ${name}@${version}: staged platform tarball carries its ` +
        `declared payload (structural verify on the staged bytes).`,
    )
    return true
  } finally {
    await safeDelete(tmpDir)
  }
}
