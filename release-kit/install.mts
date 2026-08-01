/**
 * @file The release-kit installer: copy the selected channels' payload
 *   files into a consumer repo at `scripts/socket-release/`, byte-exact per
 *   the committed `kit-manifest.json`. Plan by default (prints the file
 *   list); `--apply` copies; `--verify` byte-compares target vs payload and
 *   exits 0 identical / 1 divergent with per-file saw/wanted sha256s, zero
 *   writes. The installer never touches `.github/workflows`, package.json,
 *   or `.gitignore` — that is the bootstrap `staged-config` step's job. The
 *   consumer config is seeded from the template ONLY if absent.
 *   Usage: node release-kit/install.mts --target <dir> --channels <a,b,...>
 *   [--apply] [--force] [--verify] [--json] [--help]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib/errors/message'

import { isMainModule } from './payload/scripts/socket-release/_shared/is-main-module.mts'
import {
  INSTALL_PREFIX,
  PAYLOAD_ROOT,
  readTargetShas,
  resolveInstallSeams,
  sha256Hex,
} from './install/seams.mts'
import type { InstallSeams } from './install/seams.mts'
import {
  filterByChannels,
  MANIFEST_FILENAME,
  parseChannelsFlag,
  parseKitManifest,
} from './install/manifest.mts'
import type { KitChannel } from './install/manifest.mts'
import { planInstall } from './install/plan.mts'

const USAGE = `Usage: node release-kit/install.mts --target <dir> --channels <a,b,...>
    [--apply] [--force] [--verify] [--json] [--help]

  --target    consumer repo root (must contain package.json)
  --channels  comma list from npm,crates,github-release,brew (common always implied)
  --apply     perform the copies (default: plan, prints the file list)
  --force     overwrite a differing existing file (default: per-file conflict refusal)
  --verify    byte-compare target vs payload for the selected channels; zero writes
  --json      machine-readable output on stdout
  --help      this usage
`

export interface InstallRunResult {
  channels: string[]
  exitCode: number
  files: Array<{
    action: 'conflict' | 'copy' | 'missing' | 'skip-identical'
    path: string
    sha256: string
  }>
  mode: 'apply' | 'plan' | 'verify'
  target: string
}

export interface RunInstallConfig {
  apply: boolean
  channels: KitChannel[]
  force: boolean
  log?: ((line: string) => void) | undefined
  payloadRoot?: string | undefined
  seams?: InstallSeams | undefined
  target: string
  verify: boolean
}

/**
 * The whole install flow, in-process — the CLI wraps it; integration tests
 * call it against temp dirs with real fs.
 */
export function runInstall(config: RunInstallConfig): InstallRunResult {
  const cfg = { __proto__: null, ...config } as RunInstallConfig
  const payloadRoot = cfg.payloadRoot ?? PAYLOAD_ROOT
  const seams = cfg.seams ?? resolveInstallSeams(payloadRoot)
  const log = cfg.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const mode: InstallRunResult['mode'] = cfg.verify
    ? 'verify'
    : cfg.apply
      ? 'apply'
      : 'plan'
  const result: InstallRunResult = {
    channels: ['common', ...cfg.channels],
    exitCode: 0,
    files: [],
    mode,
    target: cfg.target,
  }

  const manifestRaw = seams.readPayloadFile(MANIFEST_FILENAME)
  if (manifestRaw === undefined) {
    log(
      [
        'Kit manifest is missing from the payload.',
        `  Where: ${path.join(payloadRoot, MANIFEST_FILENAME)}`,
        '  Saw: no such file',
        '  Wanted: the committed kit-manifest.json',
        '  Fix: node release-kit/gen-manifest.mts',
      ].join('\n'),
    )
    result.exitCode = 1
    return result
  }
  const manifest = parseKitManifest(
    manifestRaw,
    path.join(payloadRoot, MANIFEST_FILENAME),
  )
  const entries = filterByChannels(manifest.files, cfg.channels)
  // The manifest itself travels with every install so `--verify` can run
  // from the consumer side later.
  const manifestEntry = {
    channels: ['common' as const],
    path: MANIFEST_FILENAME,
    sha256: sha256Hex(manifestRaw),
  }
  const allEntries = [...entries, manifestEntry]
  const targetReads = readTargetShas(
    seams,
    allEntries.map(e => e.path),
    cfg.target,
  )

  if (mode === 'verify') {
    let divergent = 0
    for (let i = 0, { length } = allEntries; i < length; i += 1) {
      const entry = allEntries[i]!
      const saw = targetReads.get(entry.path)
      if (saw === entry.sha256) {
        result.files.push({
          action: 'skip-identical',
          path: entry.path,
          sha256: entry.sha256,
        })
        continue
      }
      divergent += 1
      result.files.push({
        action: saw === undefined ? 'missing' : 'conflict',
        path: entry.path,
        sha256: entry.sha256,
      })
      log(`x ${entry.path}: saw ${saw ?? '(missing)'}; wanted ${entry.sha256}`)
    }
    result.exitCode = divergent === 0 ? 0 : 1
    log(
      divergent === 0
        ? `verify: ${allEntries.length} files byte-identical to the payload.`
        : `verify: ${divergent} of ${allEntries.length} files diverge from the payload.`,
    )
    return result
  }

  const plan = planInstall({ entries: allEntries, targetReads })
  for (let i = 0, { length } = plan.identical; i < length; i += 1) {
    result.files.push(plan.identical[i]!)
  }
  if (plan.conflicts.length > 0 && !cfg.force) {
    for (let i = 0, { length } = plan.conflicts; i < length; i += 1) {
      const c = plan.conflicts[i]!
      result.files.push({ action: 'conflict', path: c.path, sha256: c.sha256 })
      log(
        [
          `Refusing to overwrite ${c.path}: it diverges from the kit payload.`,
          `  Where: ${path.join(cfg.target, INSTALL_PREFIX, c.path)}`,
          `  Saw: sha256 ${c.sawSha256}`,
          `  Wanted: sha256 ${c.sha256}`,
          '  Fix: re-run with --force to restore the kit bytes, or reconcile your edit upstream into release-kit/payload.',
        ].join('\n'),
      )
    }
    result.exitCode = 1
    return result
  }
  const toCopy = [...plan.copies, ...(cfg.force ? plan.conflicts : [])]
  for (let i = 0, { length } = toCopy; i < length; i += 1) {
    const f = toCopy[i]!
    result.files.push({ action: 'copy', path: f.path, sha256: f.sha256 })
    if (mode === 'apply') {
      seams.copyFile(f.path, cfg.target)
    } else {
      log(`copy ${INSTALL_PREFIX}/${f.path}`)
    }
  }
  if (mode === 'apply') {
    // Seed the consumer config from the template ONLY if absent.
    const configPath = path.join(cfg.target, '.config/socket-release.json')
    if (!seams.targetFileExists(configPath)) {
      const template = seams.readPayloadFile(
        'templates/config/socket-release.json',
      )
      if (template !== undefined) {
        seams.writeTargetFile(configPath, template)
        log('seeded .config/socket-release.json from the template.')
      }
    }
    log(
      `installed ${toCopy.length} file(s) (${plan.identical.length} already identical).`,
    )
    log('next: node scripts/socket-release/bootstrap.mts')
  } else {
    log(
      `plan: ${toCopy.length} file(s) to copy, ${plan.identical.length} identical, ${plan.conflicts.length} conflict(s).`,
    )
  }
  return result
}

function main(): void {
  let values: Record<string, string | boolean | undefined>
  try {
    const parsed = parseArgs({
      allowPositionals: false,
      args: process.argv.slice(2),
      options: {
        apply: { type: 'boolean' },
        channels: { type: 'string' },
        force: { type: 'boolean' },
        help: { type: 'boolean' },
        json: { type: 'boolean' },
        target: { type: 'string' },
        verify: { type: 'boolean' },
      },
      strict: true,
    })
    values = parsed.values as typeof values
  } catch (e) {
    process.stderr.write(`install: ${errorMessage(e)}\n${USAGE}`)
    process.exitCode = 2
    return
  }
  if (values['help'] === true) {
    process.stdout.write(USAGE)
    return
  }
  const targetValue = values['target']
  const channelsValue = values['channels']
  const target = typeof targetValue === 'string' ? targetValue : undefined
  const channelsRaw =
    typeof channelsValue === 'string' ? channelsValue : undefined
  if (!target || !channelsRaw) {
    process.stderr.write(
      `install: --target and --channels are required.\n${USAGE}`,
    )
    process.exitCode = 2
    return
  }
  if (!existsSync(path.join(target, 'package.json'))) {
    process.stderr.write(
      [
        'Install target is not a package root.',
        `  Where: ${target}`,
        '  Saw: no package.json',
        '  Wanted: the consumer repo root',
        '  Fix: pass --target <repo-root>.',
        '',
      ].join('\n'),
    )
    process.exitCode = 2
    return
  }
  let channels: KitChannel[]
  try {
    channels = parseChannelsFlag(channelsRaw)
  } catch (e) {
    process.stderr.write(`install: ${errorMessage(e)}\n${USAGE}`)
    process.exitCode = 2
    return
  }
  const result = runInstall({
    apply: values['apply'] === true,
    channels,
    force: values['force'] === true,
    target,
    verify: values['verify'] === true,
  })
  if (values['json'] === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  process.exitCode = result.exitCode
}

// Entrypoint-guarded so tests can import runInstall without running the CLI.
if (isMainModule(import.meta.url)) {
  main()
}
