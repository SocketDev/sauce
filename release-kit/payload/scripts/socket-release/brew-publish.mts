/**
 * @file Bump the Homebrew tap formula for an ALREADY-CUT release. Ordered
 *   gates, dry-run default: (1) config + subject; (2) tag-tied — the tag
 *   must already be on origin, this tool never creates tags; (3) the GitHub
 *   release exists and is not a draft; (4) every templated asset exists on
 *   the release; (5) checksum authority — the sha256s come ONLY from the
 *   release's own checksums.txt, never re-hashed; (6) plan the formula bump;
 *   (7) unchanged → no-op exit 0; (8) dry-run prints the plan + the exact
 *   apply command; (9) `--apply` commits direct to the tap default branch
 *   (GitHub-signed API commit, never a PR) and the re-read must echo the
 *   desired formula — success is the registry's answer, never the click.
 *   Usage: node scripts/socket-release/brew-publish.mts --tag vX.Y.Z
 *   [--apply] [--json] [--tap <owner/name>] [--formula <name>]
 *   [--repo <owner/name>]
 */

import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'
import { parseKitConfig } from './bootstrap/config.mts'
import { parseGitHubSlug } from './publish-infra/pin-readme.mts'
import { runCapture } from './publish-infra/shared.mts'
import {
  FORMULA_PLATFORMS,
  planFormulaBump,
} from './publish-infra/brew/formula.mts'
import type {
  FormulaPlatform,
  FormulaSpec,
} from './publish-infra/brew/formula.mts'
import {
  assetNamesForTriplets,
  formulaClassName,
  formulaPath,
  normalizeTap,
  parseChecksumsTxt,
} from './publish-infra/brew/shared.mts'
import {
  commitFormula,
  readTapFormula,
  resolveBrewSeams,
} from './publish-infra/brew/tap.mts'
import type { BrewSeams } from './publish-infra/brew/tap.mts'

const logger = getDefaultLogger()

export interface BrewPublishConfig {
  apply: boolean
  brewConfig:
    | {
        assetTemplate: string
        formula: string
        tap: string
        triplets: string[]
      }
    | undefined
  formula?: string | undefined
  json: boolean
  repoRoot: string
  seams: BrewSeams
  slug: string
  tag: string
  tap?: string | undefined
}

export interface BrewPublishResult {
  action?: string | undefined
  checks: Array<{
    fix?: string | undefined
    id: string
    ok: boolean
    saw: string
  }>
  exitCode: number
}

/**
 * The whole flow with injected seams — the CLI wraps this; tests call it
 * with fakes and assert check ids + exit codes + zero commit calls.
 */
export async function runBrewPublish(
  config: BrewPublishConfig,
): Promise<BrewPublishResult> {
  const cfg = { __proto__: null, ...config } as BrewPublishConfig
  const checks: BrewPublishResult['checks'] = []
  const refuse = (
    id: string,
    lines: string[],
    saw: string,
    fix?: string | undefined,
  ): BrewPublishResult => {
    checks.push({ fix, id, ok: false, saw })
    for (let i = 0, { length } = lines; i < length; i += 1) {
      logger.fail(lines[i]!)
    }
    return { checks, exitCode: 1 }
  }

  const seams = cfg.seams
  const version = cfg.tag.replace(/^v/, '')
  const brew = cfg.brewConfig
  if (!brew) {
    return refuse(
      'config-brew-block',
      [
        'x the brew channel is not configured.',
        '  Fix: add the "brew" block to .config/socket-release.json (tap, formula, assetTemplate, triplets).',
      ],
      'no brew block',
      'add the brew block to .config/socket-release.json',
    )
  }
  const tap = normalizeTap(cfg.tap ?? brew.tap)
  const productName = cfg.formula || brew.formula || cfg.slug.split('/')[1]!
  const spec = { assetTemplate: brew.assetTemplate, triplets: brew.triplets }

  // 2. Tag-tied: the tag must already be on origin.
  const tagRead = await seams.ghApiJson(
    `repos/${cfg.slug}/git/ref/tags/${cfg.tag}`,
  )
  if (tagRead.code !== 0) {
    return refuse(
      'tag-on-origin',
      [
        `x tag "${cfg.tag}" is not on origin ${cfg.slug}.`,
        'A formula bump must tie to an already-pushed tag; this tool never creates tags.',
        'Fix: cut the release first (registry publish -> tag -> GitHub release), then re-run brew-publish.',
      ],
      `no ref tags/${cfg.tag}`,
      'cut the release first (registry publish -> tag -> GitHub release), then re-run brew-publish.',
    )
  }
  checks.push({ id: 'tag-on-origin', ok: true, saw: cfg.tag })

  // 3. Release exists and is not a draft.
  const release = await seams.ghReleaseView(cfg.tag, cfg.slug)
  if (!release.exists || release.isDraft) {
    return refuse(
      'release-published',
      [
        `x release ${cfg.tag} on ${cfg.slug} is ${release.exists ? 'a draft' : 'missing'}.`,
        'Fix: finish the release cut; a draft release is not a release.',
      ],
      release.exists ? 'draft' : 'missing',
      'finish the release cut; a draft release is not a release',
    )
  }
  checks.push({ id: 'release-published', ok: true, saw: 'published' })

  // 4. Every templated asset must exist on the release.
  const assets = assetNamesForTriplets(
    productName,
    version,
    spec.assetTemplate,
    spec.triplets,
  )
  for (let i = 0, { length } = assets; i < length; i += 1) {
    const { asset } = assets[i]!
    if (!release.assets.includes(asset)) {
      return refuse(
        'assets-present',
        [
          `x asset "${asset}" does not exist on release ${cfg.tag}.`,
          'Fix: build and upload the asset before bumping the formula, or remove the triplet from .config/socket-release.json brew.triplets.',
        ],
        `missing ${asset}`,
        'build and upload the asset before bumping the formula, or remove the triplet from .config/socket-release.json brew.triplets.',
      )
    }
  }
  checks.push({
    id: 'assets-present',
    ok: true,
    saw: `${assets.length} assets`,
  })

  // 5. Checksum authority: the release's own checksums.txt, never re-hashed.
  const checksumsText = await seams.downloadChecksums(cfg.tag, cfg.slug)
  if (checksumsText === undefined) {
    return refuse(
      'checksums-authority',
      [
        `x release ${cfg.tag} carries no checksums.txt.`,
        "The formula sha256 is derived from the release's own checksum manifest, never re-hashed independently.",
        'Fix: produce releases with scripts/socket-release/create-release.mts (it writes sha256-hex checksums.txt).',
      ],
      'no checksums.txt',
      'produce releases with scripts/socket-release/create-release.mts (it writes sha256-hex checksums.txt).',
    )
  }
  const checksums = parseChecksumsTxt(checksumsText)
  const platforms = {} as FormulaSpec['platforms']
  for (let i = 0, { length } = assets; i < length; i += 1) {
    const { asset, triplet } = assets[i]!
    const hex = checksums.get(asset)
    if (hex === undefined) {
      return refuse(
        'checksums-cover-assets',
        [
          `x checksums.txt on release ${cfg.tag} does not name ${asset}.`,
          'Fix: regenerate the release checksums so every published asset is covered.',
        ],
        `no sha256 for ${asset}`,
        'regenerate the release checksums so every published asset is covered.',
      )
    }
    if ((FORMULA_PLATFORMS as readonly string[]).includes(triplet)) {
      platforms[triplet as FormulaPlatform] = {
        sha256: hex,
        url: `https://github.com/${cfg.slug}/releases/download/${cfg.tag}/${asset}`,
      }
    }
  }
  checks.push({
    id: 'checksums-authority',
    ok: true,
    saw: 'checksums.txt parsed',
  })

  // 6. Desired spec -> current tap formula -> bump plan.
  const desired: FormulaSpec = {
    className: formulaClassName(productName),
    desc: `${productName} (Socket release)`,
    homepage: `https://github.com/${cfg.slug}`,
    license: 'MIT',
    name: productName,
    platforms,
  }
  const fPath = formulaPath(productName)
  const current = await readTapFormula(seams, tap.repo, fPath)
  const bump = planFormulaBump(current?.raw, desired)

  // 7. Unchanged -> no-op.
  if (bump.action === 'unchanged') {
    logger.log(
      `Formula ${productName} already reads ${version}; leaving it untouched.`,
    )
    checks.push({ id: 'formula-bump', ok: true, saw: 'unchanged' })
    return { action: 'unchanged', checks, exitCode: 0 }
  }

  // 8. Dry-run: print the plan + the exact apply command.
  if (!cfg.apply) {
    logger.log(`brew-publish plan (${bump.action}):`)
    logger.log(`  tap repo: ${tap.repo}`)
    logger.log(`  path: ${fPath}`)
    logger.log(`  version: ${version}`)
    for (let i = 0, { length } = FORMULA_PLATFORMS; i < length; i += 1) {
      const p = FORMULA_PLATFORMS[i]!
      const entry = platforms[p]
      if (entry) {
        logger.log(`  ${p}: sha256 ${entry.sha256}`)
      }
    }
    logger.log(
      `  apply: node scripts/socket-release/brew-publish.mts --tag ${cfg.tag} --apply`,
    )
    checks.push({
      id: 'formula-bump',
      ok: true,
      saw: `[dry-run] ${bump.action}`,
    })
    return { action: bump.action, checks, exitCode: 0 }
  }

  // 9. Apply: GitHub-signed commit direct to the tap default branch, then a
  // re-read that must echo the desired formula.
  const committed = await commitFormula(seams, {
    content: bump.rendered,
    formulaName: productName,
    path: fPath,
    repo: tap.repo,
    version,
  })
  if (!committed.verified) {
    return refuse(
      'formula-verified',
      [
        `x Formula bump saved-state unproven for ${productName}.`,
        `  Where: ${tap.repo}/${fPath} re-read after the commit`,
        '  Saw: bytes differing from the rendered formula',
        '  Wanted: the committed formula byte-identical to the plan',
        `  Fix: re-run \`node scripts/socket-release/brew-publish.mts --tag ${cfg.tag} --apply\` — success is the registry's answer, never the click.`,
      ],
      're-read mismatch',
      `re-run node scripts/socket-release/brew-publish.mts --tag ${cfg.tag} --apply`,
    )
  }
  logger.log(`Formula ${productName} bumped to ${version} on ${tap.repo}.`)
  checks.push({ id: 'formula-verified', ok: true, saw: version })
  return { action: bump.action, checks, exitCode: 0 }
}

async function main(): Promise<void> {
  let values: {
    apply?: boolean
    formula?: string
    help?: boolean
    json?: boolean
    repo?: string
    tag?: string
    tap?: string
  }
  try {
    ;({ values } = parseArgs({
      allowPositionals: false,
      args: process.argv.slice(2),
      options: {
        apply: { type: 'boolean' },
        formula: { type: 'string' },
        help: { type: 'boolean' },
        json: { type: 'boolean' },
        repo: { type: 'string' },
        tag: { type: 'string' },
        tap: { type: 'string' },
      },
      strict: true,
    }))
  } catch (e) {
    logger.fail(errorMessage(e))
    logger.error(
      'Usage: node scripts/socket-release/brew-publish.mts --tag vX.Y.Z [--apply] [--json] [--tap <owner/name>] [--formula <name>] [--repo <owner/name>]',
    )
    process.exitCode = 2
    return
  }
  if (values.help) {
    logger.log(
      'Usage: node scripts/socket-release/brew-publish.mts --tag vX.Y.Z [--apply] [--json] [--tap <owner/name>] [--formula <name>] [--repo <owner/name>]',
    )
    return
  }
  if (!values.tag || !/^v\d/.test(values.tag)) {
    logger.fail('brew-publish: --tag vX.Y.Z is required.')
    process.exitCode = 2
    return
  }
  const fs = await import('node:fs')
  const configPath = path.join(REPO_ROOT, '.config/socket-release.json')
  let brewConfig: BrewPublishConfig['brewConfig']
  try {
    const kitConfig = parseKitConfig(
      fs.readFileSync(configPath, 'utf8'),
      configPath,
    )
    brewConfig = kitConfig.brew
  } catch (e) {
    logger.fail(errorMessage(e))
    process.exitCode = 2
    return
  }
  let slug = values.repo
  if (!slug) {
    const origin = await runCapture(
      'git',
      ['remote', 'get-url', 'origin'],
      REPO_ROOT,
    )
    slug = origin.code === 0 ? parseGitHubSlug(origin.stdout.trim()) : undefined
  }
  if (!slug) {
    logger.fail(
      'brew-publish: could not resolve the product repo — pass --repo <owner/name>.',
    )
    process.exitCode = 2
    return
  }
  const result = await runBrewPublish({
    apply: values.apply === true,
    brewConfig,
    formula: values.formula,
    json: values.json === true,
    repoRoot: REPO_ROOT,
    seams: resolveBrewSeams(REPO_ROOT),
    slug,
    tag: values.tag,
    tap: values.tap,
  })
  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  process.exitCode = result.exitCode
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
