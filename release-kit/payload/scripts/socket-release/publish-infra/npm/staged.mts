/**
 * @file `--staged` / `--direct` publish modes, and the pre-approve tarball
 *   pack + integrity-gate helpers `--approve` verifies against before
 *   promoting a staged package to public.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { releaseBehindLiveGate } from '../release.mts'
import { logger, provenanceAllowed, rootPath, runInherit } from '../shared.mts'
import { withPinnedReadme } from '../pin-readme.mts'
import { withPrunedPackManifest } from './pack-manifest.mts'
import { verifyPackedPayload } from './pack-preflight.mts'
import {
  diagnoseStageConflict,
  diagnoseStagedAuthFailure,
  fetchPublishedState,
  isAlreadyPublished,
} from './registry.mts'
import type { PublishedState } from './registry.mts'
import {
  isStagingExpected,
  logNpmApproveHandoff,
  resolveReleaseAccess,
} from './shared.mts'
import { runWorkspacePublish } from './staged-workspace.mts'
import { resolveNpmWorkspaceLayout } from './workspace.mts'
import { resolveReleaseSubject } from '../../_shared/release-subject.mts'

import type { WorkspaceManifestShape } from './workspace.mts'
import type { ReleaseSubject } from '../../_shared/release-subject.mts'
import { getEnvValue } from '@socketsecurity/lib/env/rewire'

// The README-pin bracket target for a publish subject: the pinned README is
// the one that PACKS — the subject's, not the repo root's when
// publishConfig.directory redirects the publish. Shared by runStaged,
// runDirect, and the approve-time verify pack so every pack of one release
// pins identical bytes.
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

export type StageDecision = 'already-published' | 'stage'

/**
 * The verify-BEFORE-stage decision: should a target version be STAGED, or is it
 * ALREADY PUBLISHED? Pure so it is unit-tested without the network.
 *
 * WHY: staging a version that is already live returns a confusing
 * `[E409] Cannot stage previously published version`, and an operator who
 * retries just re-hits the 409. When the target is already on the registry
 * there is nothing to stage — the caller skips straight to
 * verify/approve/release+reconcile, where the release stage cuts the tag + GH
 * release if they are missing. Both the `versions` list AND `dist-tags.latest`
 * are consulted: a match on either is proof the version is published, so a
 * partial read that dropped the version from `versions` but still named it
 * `latest` is still caught. The reads that feed this MUST be cache-busted (see
 * registry.mts:cacheBustedRead) — a stale CDN packument that omits a live
 * version would otherwise green-light a doomed stage.
 */
export function stageAction(config: {
  publishedLatest: string | undefined
  publishedVersions: readonly string[]
  target: string
}): StageDecision {
  const { publishedLatest, publishedVersions, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  const published =
    target === publishedLatest || publishedVersions.includes(target)
  return published ? 'already-published' : 'stage'
}

/**
 * `--staged` mode: stage this package's tarball.
 *
 * Reads the local package.json for name + version, refuses to stage an
 * already-published version (npm rejects republishes outright; we surface the
 * error before the network call). Runs `pnpm stage publish` with --provenance
 * when GITHUB_ACTIONS is set AND the source repository is public
 * (provenanceAllowed) so the OIDC token gets embedded into the provenance
 * attestation; a private-repo run skips the flag loudly instead of hitting
 * npm's E422 sigstore-visibility rejection.
 */
export async function runStaged(
  tag: string,
  config: { dryRun: boolean },
): Promise<void> {
  const { dryRun } = { __proto__: null, ...config } as typeof config
  // Multi-package workspace, decmpfs, stuie: the workspace runner publishes
  // every member in dependency order behind the lockstep + hollow gates.
  // Single-package repos take the identical-to-before subject path below.
  const layout = resolveNpmWorkspaceLayout(rootPath)
  if (layout.kind === 'multi') {
    await runWorkspacePublish('staged', tag, layout, { dryRun })
    return
  }
  const pkg = resolveReleaseSubject(rootPath)
  logger.log(
    `Staging ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  // Verify BEFORE staging: a cache-busted packument read (never a stale CDN
  // copy) settles whether the target is already live. If it is, staging would
  // return a confusing `[E409] Cannot stage previously published version`, so
  // skip the stage cleanly and let the pipeline advance — the release stage
  // cuts the tag + GH release if they are still missing.
  const published = await fetchPublishedState(pkg.name)
  if (
    stageAction({
      publishedLatest: published.latest,
      publishedVersions: published.versions,
      target: pkg.version,
    }) === 'already-published'
  ) {
    logger.success(
      `${pkg.name}@${pkg.version} already published — nothing to stage; ` +
        `proceed to verify/approve/release+reconcile (the release stage cuts ` +
        `the tag + GH release if missing).`,
    )
    return
  }

  const access = resolveReleaseAccess({
    manifestPath: pkg.manifestPath,
    packageName: pkg.name,
  })
  const args = [
    'stage',
    'publish',
    '--access',
    access,
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (getEnvValue('GITHUB_ACTIONS') === 'true') {
    if (provenanceAllowed()) {
      args.push('--provenance')
    } else {
      logger.warn(
        'Provenance skipped: npm only verifies sigstore bundles from PUBLIC ' +
          'source repositories, and this run is not one. The upload proceeds ' +
          'unattested; provenance turns back on automatically when the repo ' +
          'is public.',
      )
    }
  }
  if (dryRun) {
    // pnpm stage publish --dry-run does everything except the actual
    // upload; surfaces packing errors + manifest validation without
    // touching the registry.
    args.push('--dry-run')
  }
  // Pin the SUBJECT README's relative asset URLs to the release tag for the
  // packed tarball only, restored right after, so the npm page's badge is
  // immutable + matches this version instead of a moving HEAD ref, and prune
  // repo-only lifecycle scripts from the manifest that packs. The same
  // brackets wrap the --approve verify pack (defaultPackTarball) so the
  // integrity gate sees identical bytes. The pack preflight runs INSIDE the
  // brackets too — the bytes it inspects are the bytes the stage command
  // uploads — and a tarball missing any declared payload file stops the
  // publish before the command runs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
  const subjectManifest = JSON.parse(
    readFileSync(pkg.manifestPath, 'utf8'),
  ) as WorkspaceManifestShape
  let preflightOk = true
  const code = await withPinnedReadme(pinTargetFor(pkg), () =>
    withPrunedPackManifest(pkg.dir, async () => {
      preflightOk = await verifyPackedPayload({
        dir: pkg.dir,
        manifest: subjectManifest,
        name: pkg.name,
        version: pkg.version,
      })
      if (!preflightOk) {
        return 1
      }
      return await runInherit('pnpm', args, rootPath)
    }),
  )
  if (!preflightOk) {
    process.exitCode = 1
    return
  }
  if (code !== 0) {
    logger.fail(`pnpm stage publish exited ${code}`)
    for (const line of await diagnoseStageConflict(pkg.name, pkg.version)) {
      logger.fail(line)
    }
    for (const line of await diagnoseStagedAuthFailure(pkg.name)) {
      logger.fail(line)
    }
    process.exitCode = code
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to upload.`,
    )
  } else {
    logger.success(`Staged ${pkg.name}@${pkg.version}.`)
    logNpmApproveHandoff()
  }
}

/**
 * `--direct` mode: classic single-step `pnpm publish` — upload + make public in
 * one call, no stage/approve. Escape hatch for environments where the stage
 * endpoint is unreachable. Adds `--provenance` automatically when
 * GITHUB_ACTIONS is set and the source repository is public
 * (provenanceAllowed) so the OIDC token still embeds into the provenance
 * attestation.
 *
 * Refuses to run when the package's prior versions used staging (per the
 * packument's `_npmUser.approver` signal). Downgrading erases the trust signal
 * from the package's history. Operators who hit the refusal should either use
 * `--staged` (preferred) or accept the trust regression by removing the prior
 * staged-published versions from the registry first.
 */
// oxlint-disable-next-line eslint/complexity -- branch dispatcher
export async function runDirect(
  tag: string,
  config: {
    dryRun: boolean
    ensureAlreadyPublishedRelease?:
      | ((pkg: { name: string; version: string }) => Promise<boolean>)
      | undefined
    fetchPublished?: ((name: string) => Promise<PublishedState>) | undefined
    root?: string | undefined
  },
): Promise<void> {
  const {
    dryRun,
    ensureAlreadyPublishedRelease,
    fetchPublished,
    root: rootOverride,
  } = { __proto__: null, ...config } as typeof config
  const root = rootOverride ?? rootPath
  // Multi-package workspace: same delegation as runStaged.
  const layout = resolveNpmWorkspaceLayout(root)
  if (layout.kind === 'multi') {
    await runWorkspacePublish('direct', tag, layout, { dryRun })
    return
  }
  const pkg = resolveReleaseSubject(root)
  logger.log(
    `Direct-publishing ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  // Verify BEFORE publishing: a cache-busted packument read settles whether the
  // target is already live. If it is, re-publishing errors; skip the upload and
  // heal idempotently — ensure the tag + GH release exist behind the liveness
  // gate — instead of failing.
  const published = await (fetchPublished ?? fetchPublishedState)(pkg.name)
  if (
    stageAction({
      publishedLatest: published.latest,
      publishedVersions: published.versions,
      target: pkg.version,
    }) === 'already-published'
  ) {
    if (dryRun) {
      logger.log(
        `[dry-run] ${pkg.name}@${pkg.version} already published — would ensure ` +
          `the tag + GitHub release exist (no writes).`,
      )
      return
    }
    logger.success(
      `${pkg.name}@${pkg.version} already published — nothing to publish; ` +
        `ensuring the tag + GH release exist.`,
    )
    const ensureRelease =
      ensureAlreadyPublishedRelease ??
      ((target: { name: string; version: string }) =>
        releaseBehindLiveGate({
          isLive: () => isAlreadyPublished(target.name, target.version),
          pkg: target,
          registry: 'npm',
        }))
    const released = await ensureRelease({
      name: pkg.name,
      version: pkg.version,
    })
    if (!released) {
      process.exitCode = 1
    }
    return
  }

  // Trust-downgrade refusal: if any prior version of this package was
  // staged-published (carries `_npmUser.approver`), --direct would erase
  // that trust signal. Force the operator to use --staged or make the
  // downgrade explicit. Skips on first-publish packages (no prior
  // versions) and on network failure (which we treat as "unknown").
  if (await isStagingExpected(pkg.name)) {
    logger.fail(
      `${pkg.name} has prior staged-published versions (per registry _npmUser.approver). ` +
        `--direct would downgrade the trust signal. Use --staged instead, or ` +
        `(rare) remove the prior staged-published versions first.`,
    )
    process.exitCode = 1
    return
  }

  const access = resolveReleaseAccess({
    manifestPath: pkg.manifestPath,
    packageName: pkg.name,
  })
  const args = [
    'publish',
    '--access',
    access,
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (getEnvValue('GITHUB_ACTIONS') === 'true') {
    if (provenanceAllowed()) {
      args.push('--provenance')
    } else {
      logger.warn(
        'Provenance skipped: npm only verifies sigstore bundles from PUBLIC ' +
          'source repositories, and this run is not one. The upload proceeds ' +
          'unattested; provenance turns back on automatically when the repo ' +
          'is public.',
      )
    }
  }
  if (dryRun) {
    args.push('--dry-run')
  }
  // Pin the SUBJECT README to the release tag + prune repo-only lifecycle
  // scripts for the published tarball only, and run the pack preflight inside
  // the same brackets so a hollow tarball never publishes (see runStaged).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
  const subjectManifest = JSON.parse(
    readFileSync(pkg.manifestPath, 'utf8'),
  ) as WorkspaceManifestShape
  let preflightOk = true
  const code = await withPinnedReadme(pinTargetFor(pkg), () =>
    withPrunedPackManifest(pkg.dir, async () => {
      preflightOk = await verifyPackedPayload({
        dir: pkg.dir,
        manifest: subjectManifest,
        name: pkg.name,
        version: pkg.version,
      })
      if (!preflightOk) {
        return 1
      }
      return await runInherit('pnpm', args, rootPath)
    }),
  )
  if (!preflightOk) {
    process.exitCode = 1
    return
  }
  if (code !== 0) {
    logger.fail(`pnpm publish exited ${code}`)
    process.exitCode = code
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to publish.`,
    )
  } else {
    logger.success(`Published ${pkg.name}@${pkg.version} directly.`)
    // The tag + immutable release are the LAST markers: cut them only once
    // the version is actually resolvable on the registry.
    const released = await releaseBehindLiveGate({
      isLive: () => isAlreadyPublished(pkg.name, pkg.version),
      pkg: { name: pkg.name, version: pkg.version },
      registry: 'npm',
    })
    if (!released) {
      process.exitCode = 1
    }
  }
}

export {
  compareExtractedTarballs,
  composeTarballProviders,
  defaultDownloadStagedTarball,
  defaultPackTarball,
  verifyStagedEntry,
  verifyStagedEntryRouted,
} from './staged-verify.mts'
export type { TarballProvider } from './staged-verify.mts'
