/*
 * @file Fleet-canonical cargo (crates.io) publish runner — the Rust analog of
 *   npm-publish.mts. Three modes:
 *
 *   --staged  Verify + package the crate WITHOUT uploading. crates.io has no
 *     staging endpoint, so "staged" means: run `cargo publish --dry-run --locked`
 *     (packages AND compiles from the packaged sources — the real verification),
 *     produce the `.crate`, and record its sha256 as the digest a downstream
 *     `--approve` integrity-gates against. THIS IS THE DEFAULT path. Nothing is
 *     public. In CI the workflow handles provenance/attestation.
 *   --approve  Local, human-gated PERMANENT promote: re-pack + sha256-verify
 *     against the staged digest, confirm, then `cargo publish --locked`, then
 *     create the git tag + GitHub release (the `.crate` + checksums as assets).
 *   --direct  Classic single-step `cargo publish --locked` — build + upload +
 *     public in one call, no stage/approve. Then tag + release.
 *   --dry-run  Forwarded to the underlying cargo command / bump preview.
 *
 *   crates.io publishing is PERMANENT: a version can only be yanked, never
 *   re-published or overwritten. The stage/approve split keeps a human gate in
 *   front of that permanence.
 *
 *   This file is the thin entry: arg parsing + mode dispatch. The implementation
 *   lives under `publish-infra/`, organized in registry tiers alongside npm: the
 *   agnostic core (`publish-infra/shared.mts` — spawn/git/JSON helpers,
 *   `publish-infra/release.mts` — git tag + GitHub release) and the cargo tier
 *   (`publish-infra/cargo/` — metadata resolution, crates.io reads,
 *   staged/direct modes, and the approve flow).
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib/argv/parse'

import {
  resolveStagedSha256,
  runApprove,
} from './publish-infra/cargo/approve.mts'
import {
  crateNameStatus,
  fetchPublishedVersion,
  isAlreadyPublished,
} from './publish-infra/cargo/registry.mts'
import {
  cratePath,
  crateSha256,
  readCargoPackage,
} from './publish-infra/cargo/shared.mts'
import {
  packCrate,
  packCrateAssets,
  runDirect,
  runStaged,
} from './publish-infra/cargo/staged.mts'
import {
  ensureTagAndRelease,
  extractChangelogSection,
} from './publish-infra/release.mts'
import { logger } from './publish-infra/shared.mts'
import { unknownFlags, unknownFlagsMessage } from './_shared/cli-flags.mts'
import { isMainModule } from './_shared/is-main-module.mts'

export {
  crateNameStatus,
  cratePath,
  crateSha256,
  ensureTagAndRelease,
  extractChangelogSection,
  fetchPublishedVersion,
  isAlreadyPublished,
  packCrate,
  packCrateAssets,
  readCargoPackage,
  resolveStagedSha256,
}

const OPTIONS = {
  approve: { default: false, type: 'boolean' },
  direct: { default: false, type: 'boolean' },
  'dry-run': { default: false, type: 'boolean' },
  help: { default: false, type: 'boolean' },
  // Accepted for signature parity with npm-publish.mts; a no-op on crates.io
  // (no OTP on publish). Threaded to runApprove so the parity is honest.
  otp: { type: 'string' },
  package: { type: 'string' },
  staged: { default: false, type: 'boolean' },
  yes: { default: false, type: 'boolean' },
} as const

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: OPTIONS,
    allowPositionals: false,
    strict: false,
  })

  const unknown = unknownFlags(values, Object.keys(OPTIONS))
  if (unknown.length > 0) {
    logger.fail(unknownFlagsMessage(unknown))
    logger.error(
      'Usage: node scripts/socket-release/cargo-publish.mts [--staged | --approve | --direct] [--dry-run] [--package <name>] [--yes]',
    )
    process.exitCode = 2
    return
  }

  if (values['help']) {
    logger.log(
      'Usage: cargo-publish [--staged | --approve | --direct] [--dry-run] [--package <name>] [--yes]',
    )
    logger.log('  (no mode → --staged, the default publish path)')
    logger.log('')
    logger.log(
      '  --staged             verify + package the crate (cargo publish',
    )
    logger.log(
      '                       --dry-run) and record its sha256; nothing is',
    )
    logger.log('                       uploaded (recommended default)')
    logger.log(
      '  --approve            local: sha256-verify + confirm, then publish',
    )
    logger.log('                       (PERMANENT), then tag + GitHub release')
    logger.log(
      '  --direct             classic `cargo publish` — public in one step,',
    )
    logger.log('                       no stage/approve, then tag + release')
    logger.log('  --dry-run            simulate; no registry writes')
    logger.log(
      '  --package <name>     select one crate in a multi-crate workspace',
    )
    logger.log('  --yes                approve without the confirmation prompt')
    logger.log(
      '  --otp <code>         accepted for parity; no-op on crates.io (no OTP)',
    )
    process.exitCode = 0
    return
  }

  const modes = [values['staged'], values['approve'], values['direct']].filter(
    Boolean,
  ).length
  if (modes > 1) {
    logger.fail('Pass at most one of --staged / --approve / --direct.')
    process.exitCode = 1
    return
  }
  // Default to staged — the safest path (verified + hashed artifact behind a
  // human approval gate before anything permanent goes public).
  const mode = values['direct']
    ? 'direct'
    : values['approve']
      ? 'approve'
      : 'staged'

  const dryRun = !!values['dry-run']
  const packageName =
    typeof values['package'] === 'string' ? values['package'] : undefined
  const otpFromFlag =
    typeof values['otp'] === 'string' ? values['otp'] : undefined

  // The kit defers CI auto-bump (deferral 1): the operator bumps the version
  // with the load-bearing `chore: bump version to <version>` subject, pushes,
  // and only then runs a publish mode. No release branch exists to promote or
  // discard, so the publish call is the whole body.
  if (mode === 'staged') {
    await runStaged({ dryRun, packageName })
  } else if (mode === 'direct') {
    await runDirect({ dryRun, packageName })
  } else {
    await runApprove({
      dryRun,
      otpFromFlag,
      packageName,
      yes: !!values['yes'],
    })
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
