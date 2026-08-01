/**
 * @file The tag-gap healer: ensure the `v<version>` git tag + immutable
 *   GitHub release exist for a version that is ALREADY live on its registry.
 *   ORDER RULE, enforced by `requireRegistryLive`: the immutable release is
 *   the FINAL marker of a release — it can only follow a live registry
 *   publish, never precede one. Manual invocation heals a release gap
 *   (public version, missing tag/release); the github-release.yml workflow's
 *   `ensure-release` job runs the same path with `GH_TOKEN` for the API tag
 *   fallback. Dry-run default: without `--release` it reports what it would
 *   cut and exits.
 *   Usage: node scripts/socket-release/github-release.mts
 *   [--tag vX.Y.Z] [--release] [--help]
 */

import process from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib/errors/message'

import { isMainModule } from './_shared/is-main-module.mts'
import { resolveReleaseSubject } from './_shared/release-subject.mts'
import { REPO_ROOT } from './paths.mts'
import { isAlreadyPublished } from './publish-infra/npm/registry.mts'
import {
  ensureTagAndRelease,
  requireRegistryLive,
} from './publish-infra/release.mts'
import { logger } from './publish-infra/shared.mts'

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean' },
      release: { type: 'boolean' },
      tag: { type: 'string' },
    },
    strict: true,
  })
  if (values.help) {
    logger.log(
      'Usage: node scripts/socket-release/github-release.mts [--tag vX.Y.Z] [--release]',
    )
    logger.log(
      'Ensures the git tag + immutable GitHub release for an ALREADY-LIVE registry version.',
    )
    return
  }

  // Subject: the repo's publish subject, with --tag overriding the version.
  const subject = resolveReleaseSubject(REPO_ROOT)
  let version = subject.version
  if (values.tag) {
    const m = /^v?(\d+\.\d+\.\d+(?:[-+].*)?)$/.exec(values.tag)
    if (!m) {
      logger.fail(
        `github-release: unparseable tag "${values.tag}" — wanted vX.Y.Z.`,
      )
      process.exitCode = 2
      return
    }
    version = m[1]!
  }
  const name = subject.name

  // ORDER RULE: registry first. A version that does not resolve on the
  // registry gets NO tag and NO release from this tool.
  const live = await requireRegistryLive({
    isLive: () => isAlreadyPublished(name, version),
    registry: 'npm',
    subject: `${name}@${version}`,
  })
  if (!live) {
    process.exitCode = 1
    return
  }

  if (!values.release) {
    logger.log(
      `[dry-run] ${name}@${version} is live on npm — would ensure tag v${version} ` +
        'and the immutable GitHub release. Re-run with --release to cut them.',
    )
    return
  }

  const ok = await ensureTagAndRelease({ name, version })
  if (!ok) {
    process.exitCode = 1
    return
  }
  logger.log(`Release marker complete: v${version} tagged and released.`)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
