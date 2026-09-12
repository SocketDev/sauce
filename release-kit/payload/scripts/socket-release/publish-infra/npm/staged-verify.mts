/**
 * @file Tarball packing, download, comparison, and staged-entry verification.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs/safe'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { resolveReleaseSubject } from '../../_shared/release-subject.mts'
import type { ReleaseSubject } from '../../_shared/release-subject.mts'
import { tarExecutable } from '../../_shared/tar-executable.mts'
import type {
  HashSource,
  TarballDigest,
} from '../../lib/verify-release-hashes.mts'
import {
  compareHashSources,
  hashTarball,
} from '../../lib/verify-release-hashes.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { withPinnedReadme } from '../pin-readme.mts'
import { withPrunedPackManifest } from './pack-manifest.mts'
import type { StageListEntry } from './shared.mts'
import {
  packWorkspaceMemberTarball,
  verifyStagedPlatformEntry,
} from './staged-workspace.mts'
import { hasMachineBuiltPayload } from './workspace-plan.mts'
import { resolveNpmWorkspaceLayout } from './workspace.mts'

function pinTargetFor(subject: ReleaseSubject): {
  readmePath: string
  repository: string | { url?: string | undefined } | undefined
  rootPath: string
  version: string
} {
  return {
    readmePath: path.relative(subject.rootPath, subject.readmePath),
    repository: subject.repository,
    rootPath: subject.rootPath,
    version: subject.version,
  }
}

/**
 * Pack `<name>@<version>` from the repo root and return the tarball path, or
 * undefined if the pack failed / produced no file. pnpm pack names the tarball
 * `<scope-stripped-name>-<version>.tgz` (e.g. @socketsecurity/lib@6.0.9 →
 * socketsecurity-lib-6.0.9.tgz) — from the PUBLISH SUBJECT's manifest, and
 * writes it into the subject directory when publishConfig.directory redirects
 * the publish. `root` is injectable for tests.
 */
/**
 * A tarball provider: resolves the scan-subject bytes for `name@version` to a
 * path, or undefined when this source has nothing (a staged entry with no
 * tarballUrl, a failed download).
 */
export type TarballProvider = (
  name: string,
  version: string,
) => Promise<string | undefined>

/**
 * Compose an ordered list of tarball providers into one that tries each in
 * turn and returns the first path a source yields, falling THROUGH a source
 * that returns undefined instead of hard-failing. Returns undefined only when
 * EVERY source came up empty. This is the artifact-source fallback chain
 * (browser-read to registry-API to local pack), factored out of the approve
 * loop so the fallthrough is unit-testable without a browser.
 */
export function composeTarballProviders(
  sources: readonly TarballProvider[],
): TarballProvider {
  return async (name: string, version: string) => {
    for (let i = 0, { length } = sources; i < length; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- serial operation
      const packed = await sources[i]!(name, version)
      if (packed) {
        return packed
      }
    }
    return undefined
  }
}

export async function defaultPackTarball(
  name: string,
  version: string,
  root: string = rootPath,
): Promise<string | undefined> {
  // Multi-package workspace: pack the member that publishes `name` from its
  // own directory, pnpm packs the cwd package; a name no member publishes
  // gets the same cross-repo refusal as the single-subject path below.
  const layout = resolveNpmWorkspaceLayout(root)
  if (layout.kind === 'multi') {
    return await packWorkspaceMemberTarball(layout, name, version)
  }
  // Refuse a cross-repo pack outright: the stage list is account-scoped, so a
  // caller can hand this an entry staged from ANOTHER repo. Packing it here
  // would pin the README against the wrong manifest — this repo's repository
  // slug with the foreign entry's version — before failing anyway on the
  // tarball-name lookup. Fail loud, with zero pack side effects. The name
  // check runs against the SUBJECT manifest, so a redirected monorepo's
  // private root name never trips it.
  const subject = resolveReleaseSubject(root)
  if (subject.name !== name) {
    logger.fail(
      `Refusing to pack ${name}@${version} from ${root}: this repo's ` +
        `package is ${subject.name}. A cross-repo pack would pin the README ` +
        `against the wrong repository/version. Run the publish flow from ` +
        `${name}'s own repo.`,
    )
    return undefined
  }
  // Same README-pin + manifest-prune brackets as runStaged, so the
  // approve-time verify pack is byte-identical to the staged tarball (the
  // integrity gate compares them).
  const packed = await withPinnedReadme(
    { ...pinTargetFor(subject), version },
    () =>
      withPrunedPackManifest(subject.dir, () =>
        runCapture('pnpm', ['pack'], root),
      ),
  )
  const tarballName = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
  // pnpm pack writes into the subject directory under a publishConfig
  // redirect; probe there first, then the root for belt-and-braces.
  for (const dir of [subject.packDir, root]) {
    const tarballPath = path.join(dir, tarballName)
    if (packed.code === 0 && existsSync(tarballPath)) {
      return tarballPath
    }
  }
  return undefined
}

/**
 * Download the staged tarball for `stageId` into a fresh temp dir and return
 * its path, undefined on failure. The download endpoint requires the same
 * npm auth as the rest of the stage API.
 */
export async function defaultDownloadStagedTarball(
  stageId: string,
): Promise<string | undefined> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-staged-dl-'))
  const dl = await runCapture('pnpm', ['stage', 'download', stageId], tmpDir)
  if (dl.code !== 0) {
    return undefined
  }
  const entries = await fs.readdir(tmpDir)
  const tgz = entries.find(e => e.endsWith('.tgz'))
  return tgz ? path.join(tmpDir, tgz) : undefined
}

// Relative path → sha1-of-content for every file under `dir`, sorted walk.
async function hashDirContents(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const abs = path.join(entry.parentPath, entry.name)
    const rel = normalizePath(path.relative(dir, abs))
    // eslint-disable-next-line no-await-in-loop
    const bytes = await fs.readFile(abs)
    result.set(rel, crypto.createHash('sha1').update(bytes).digest('hex'))
  }
  return result
}

/**
 * Compare two tarballs by EXTRACTED CONTENT (per-file sha1 over relative
 * paths). The tarball-level sha1 embeds the gzip envelope — platform + tool
 * metadata that legitimately differs between CI (linux) and a local pack
 * (macOS) even when every shipped byte is identical — so content equality is
 * the honest integrity axis. Returns a human-readable detail on mismatch.
 */
export async function compareExtractedTarballs(
  tarA: string,
  tarB: string,
): Promise<{ equal: boolean; detail: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-tar-cmp-'))
  try {
    const dirA = path.join(tmpDir, 'a')
    const dirB = path.join(tmpDir, 'b')
    await fs.mkdir(dirA)
    await fs.mkdir(dirB)
    for (const [tar, dir] of [
      [tarA, dirA],
      [tarB, dirB],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      const untar = await runCapture(
        tarExecutable(),
        ['-xzf', tar, '-C', dir],
        tmpDir,
      )
      if (untar.code !== 0) {
        return { detail: `tar -xzf ${tar} exited ${untar.code}`, equal: false }
      }
    }
    const hashesA = await hashDirContents(dirA)
    const hashesB = await hashDirContents(dirB)
    const diffs: string[] = []
    for (const [rel, entryHash] of hashesA) {
      const other = hashesB.get(rel)
      if (other === undefined) {
        diffs.push(`only in first: ${rel}`)
      } else if (other !== entryHash) {
        diffs.push(`content differs: ${rel}`)
      }
    }
    for (const rel of hashesB.keys()) {
      if (!hashesA.has(rel)) {
        diffs.push(`only in second: ${rel}`)
      }
    }
    return diffs.length === 0
      ? { detail: `${hashesA.size} file(s) byte-identical`, equal: true }
      : { detail: diffs.slice(0, 10).join('; '), equal: false }
  } finally {
    await safeDelete(tmpDir)
  }
}

/**
 * Route a staged entry to the verification axis its payload supports. A
 * generated platform package or a machine-built payload (.wasm / .node) has
 * no local byte-twin, so it verifies STRUCTURALLY on the staged bytes
 * (verifyStagedPlatformEntry) — and the downloaded staged tarball is copied
 * to `<rootPath>/<name>-<version>.tgz` so the release-asset checksum pickup
 * hashes the bytes that actually shipped, never a divergent local re-pack.
 * Everything else keeps the local-pack byte-compare gate (verifyStagedEntry).
 */
export async function verifyStagedEntryRouted(
  entry: StageListEntry,
): Promise<boolean> {
  const layout = resolveNpmWorkspaceLayout(rootPath)
  const member =
    entry.name && layout.kind === 'multi'
      ? layout.packages.find(pkg => pkg.name === entry.name)
      : undefined
  if (member && (member.platform || hasMachineBuiltPayload(member.manifest))) {
    const ok = await verifyStagedPlatformEntry(entry, member, {
      downloadStagedTarball: defaultDownloadStagedTarball,
    })
    if (ok && entry.name && entry.version && entry.stageId) {
      const staged = await defaultDownloadStagedTarball(entry.stageId)
      if (staged) {
        const assetName = `${entry.name.replace(/^@/, '').replace('/', '-')}-${entry.version}.tgz`
        await fs.copyFile(staged, path.join(rootPath, assetName))
      }
    }
    return ok
  }
  return verifyStagedEntry(entry)
}

export async function verifyStagedEntry(
  entry: StageListEntry,
  options?:
    | {
        downloadStagedTarball?:
          | ((stageId: string) => Promise<string | undefined>)
          | undefined
        hashLocalTarball?: ((filePath: string) => TarballDigest) | undefined
        packTarball?:
          | ((name: string, version: string) => Promise<string | undefined>)
          | undefined
      }
    | undefined,
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as {
    downloadStagedTarball?:
      | ((stageId: string) => Promise<string | undefined>)
      | undefined
    hashLocalTarball?: ((filePath: string) => TarballDigest) | undefined
    packTarball?:
      | ((name: string, version: string) => Promise<string | undefined>)
      | undefined
  }
  const hashLocal = opts.hashLocalTarball ?? hashTarball
  const packTarball = opts.packTarball ?? defaultPackTarball
  const downloadStaged =
    opts.downloadStagedTarball ?? defaultDownloadStagedTarball
  const { name, shasum: stagedShasum, stageId, version } = entry
  if (!name || !version || !stageId) {
    logger.fail(
      `Pre-approve verify: staged entry is missing name/version/stageId.\n` +
        `  Where: ${JSON.stringify(entry)}\n` +
        `  Fix: re-stage the package; do not approve an entry the registry can't identify.`,
    )
    return false
  }
  if (!stagedShasum) {
    logger.fail(
      `Pre-approve verify: no server-side shasum for ${name}@${version}.\n` +
        `  Where: pnpm stage list --json (stageId ${stageId}) exposed no shasum field.\n` +
        `  Saw vs wanted: an entry with no digest; wanted npm's staged sha1 to compare against the local pack.\n` +
        `  Fix: reject + re-stage (node scripts/socket-release/npm-web-auth.mts stage reject ${stageId}); if pnpm's stage-list shape changed, update readStagedShasum. Refusing to approve unverified bytes.`,
    )
    return false
  }
  const tarballPath = await packTarball(name, version)
  if (!tarballPath) {
    logger.fail(
      `Pre-approve verify: could not pack ${name}@${version} locally.\n` +
        `  Where: pnpm pack in ${rootPath}\n` +
        `  Saw vs wanted: no local tarball; wanted one to hash against npm's staged shasum.\n` +
        `  Fix: fix the pack (check the build), then re-run --approve. Not approving without a local comparison.`,
    )
    return false
  }
  const local = hashLocal(tarballPath)
  const sources: HashSource[] = [
    { integrity: local.integrity, label: 'local pack', shasum: local.shasum },
    { integrity: undefined, label: 'npm staging', shasum: stagedShasum },
  ]
  const comparison = compareHashSources(sources)
  if (!comparison.ok) {
    // The tarball sha1 covers the gzip envelope too — CI (linux) and a local
    // pack (macOS) legitimately wrap identical contents differently. Fall
    // back to comparing what actually ships: the extracted files.
    logger.log(
      `Tarball sha1 differs for ${name}@${version} (envelope is platform-` +
        `sensitive); downloading the staged tarball to compare contents…`,
    )
    const stagedTarball = await downloadStaged(stageId)
    if (!stagedTarball) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}.\n` +
          `  Where: tarball sha1 mismatch AND the staged tarball could not be downloaded for a content compare.\n` +
          `    local pack:  ${local.shasum}\n` +
          `    npm staging: ${stagedShasum}\n` +
          `  Fix: check npm auth (pnpm stage download ${stageId}), or reject + re-stage. Not approving unverified bytes.`,
      )
      return false
    }
    const contents = await compareExtractedTarballs(stagedTarball, tarballPath)
    if (!contents.equal) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}.\n` +
          `  Where: comparing staged vs local pack EXTRACTED CONTENTS (after tarball sha1 mismatch).\n` +
          `  Saw vs wanted: ${contents.detail}\n` +
          `    local pack:  ${local.shasum}\n` +
          `    npm staging: ${stagedShasum}\n` +
          `  Fix: reject the staged publish (node scripts/socket-release/npm-web-auth.mts stage reject ${stageId}) and re-stage — never approve a divergent artifact.`,
      )
      return false
    }
    logger.success(
      `Verified ${name}@${version}: staged contents byte-identical to the local pack (${contents.detail}); only the gzip envelope differs.`,
    )
    return true
  }
  logger.log(
    `Verified ${name}@${version}: local pack sha1 matches npm staging (${comparison.algorithm}).`,
  )
  return true
}
