/*
 * @file `check --all` gate: the release-kit payload is internally coherent.
 *   Four assertions, all read-only:
 *
 *   1. kit-manifest.json matches the payload's current bytes (gen-manifest
 *      `--check` semantics inline) — R11 pins the POST-FORMAT bytes, so this
 *      also proves the formatter and the manifest agree.
 *   2. No payload source leaks a fleet-internal reference: `scripts/fleet/`,
 *      `@socketsecurity/lib-stable`, `@socketsecurity/sdk-stable`, or
 *      `socket-wheelhouse` — except the ONE lawful literal, the shared
 *      browser-profile dir in playwright-law.mts (and the two modules that
 *      restate it), which every Socket npm browser tool shares.
 *   3. No `*.test.*` file ships under the payload.
 *   4. The PURE modules (bootstrap plan/render/gates/config, brew
 *      formula/shared, install manifest/plan) import no effects modules —
 *      `node:fs`, `node:child_process`, `node:net`, `node:http` — a
 *      module-source scan that keeps the pure/effects split honest.
 *   5. Naming law 1 (entries): the only code files at the payload ROOT are
 *      the sanctioned flow entries plus the grandfathered residents —
 *      nothing new may be added at root.
 *   6. Naming law 6 (suffixes): every payload code file is `.mts`, except
 *      `.mjs` scripts that must run on system Node before any install
 *      (workflow gate jobs, composite-action scripts); any `.mjs` imported
 *      from TypeScript carries a `.d.mts` sidecar.
 */

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  buildManifest,
  serializeManifest,
} from '../../../release-kit/gen-manifest.mts'
import {
  PAYLOAD_ROOT,
  walkPayload,
} from '../../../release-kit/install/seams.mts'

const logger = getDefaultLogger()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

const FORBIDDEN_MARKERS = [
  'scripts/fleet/',
  '@socketsecurity/lib-stable',
  '@socketsecurity/sdk-stable',
  'socket-wheelhouse',
] as const

// The ONE lawful `socket-wheelhouse` literal: the durable Chrome profile
// every Socket npm browser tool shares (~/.config/socket-wheelhouse/…).
// Renaming it would sign every already-authenticated operator out, so the
// modules that name it are allowlisted for that marker ONLY.
const MARKER_ALLOWLIST: ReadonlyArray<{
  marker: string
  paths: readonly string[]
}> = [
  {
    marker: 'socket-wheelhouse',
    paths: [
      '_shared/playwright-law.mts',
      'publish-infra/npm/browser-session.mts',
      'publish-infra/npm/trusted-publisher-browser.mts',
    ],
  },
]

const PURE_MODULES = [
  'bootstrap/config.mts',
  'bootstrap/gates.mts',
  'bootstrap/plan.mts',
  'bootstrap/render.mts',
  'publish-infra/brew/formula.mts',
  'publish-infra/brew/shared.mts',
  'publish-infra/npm/access-parse.mts',
  'publish-infra/npm/access-plan.mts',
] as const

const SAUCE_PURE_MODULES = [
  'release-kit/install/manifest.mts',
  'release-kit/install/plan.mts',
] as const

const EFFECT_IMPORT = /from\s+['"]node:(?:child_process|fs|http|net)['"]/

// Naming law 1: the closed set of code files permitted at the payload root.
// `create-release.mts` is a grandfathered dead github-release entry, kept
// until it is deleted fleet-side. See the README "Known divergence" note.
const ROOT_ENTRY_ALLOWLIST: ReadonlySet<string> = new Set([
  'bootstrap.mts',
  'brew-publish.mts',
  'cargo-publish.mts',
  'create-release.mts',
  'github-release.mts',
  'npm-publish.mts',
  'npm-web-auth.mts',
  'paths.mts',
  'registry-liveness-gate.d.mts',
  'registry-liveness-gate.mjs',
])

// Naming law 6: `.mjs` is allowed only for scripts that run on system Node
// before any install — the two known homes are the payload-root registry
// liveness gate job and the composite-action minter under templates/actions/.
const SYSTEM_NODE_MJS: readonly RegExp[] = [
  /^registry-liveness-gate\.mjs$/,
  /^templates\/actions\/[^/]+\/[^/]+\.mjs$/,
]

const CODE_FILE = /\.(?:cjs|cts|js|mjs|mts|ts)$/
const DISALLOWED_CODE_EXT = /\.(?:cjs|cts|js|ts)$/

function isMarkerAllowlisted(rel: string, marker: string): boolean {
  return MARKER_ALLOWLIST.some(
    entry => entry.marker === marker && entry.paths.includes(rel),
  )
}

function main(): void {
  const failures: string[] = []

  // 1. Manifest freshness (gen-manifest --check inline).
  const manifestPath = path.join(PAYLOAD_ROOT, 'kit-manifest.json')
  let committed: string | undefined
  try {
    committed = readFileSync(manifestPath, 'utf8')
  } catch {
    committed = undefined
  }
  const regenerated = serializeManifest(buildManifest())
  if (committed !== regenerated) {
    failures.push(
      [
        'What: kit-manifest.json does not match the payload bytes.',
        `Where: ${manifestPath}`,
        `Saw: ${committed === undefined ? 'no manifest' : 'stale sha entries'}`,
        'Wanted: the manifest regenerated from the current (post-format) payload',
        'Fix: node release-kit/gen-manifest.mts',
      ].join('\n'),
    )
  }

  const payloadFiles = walkPayload()

  // 2. Fleet-internal markers.
  for (let i = 0, { length } = payloadFiles; i < length; i += 1) {
    const rel = payloadFiles[i]!
    if (!/\.(?:json|md|mjs|mts|txt|yml)$/.test(rel)) {
      continue
    }
    const text = readFileSync(path.join(PAYLOAD_ROOT, rel), 'utf8')
    for (let m = 0, { length: ml } = FORBIDDEN_MARKERS; m < ml; m += 1) {
      const marker = FORBIDDEN_MARKERS[m]!
      if (!text.includes(marker)) {
        continue
      }
      if (isMarkerAllowlisted(rel, marker)) {
        continue
      }
      const line = text.slice(0, text.indexOf(marker)).split('\n').length
      failures.push(
        [
          `What: the payload leaks the fleet-internal marker "${marker}".`,
          `Where: release-kit/payload/scripts/socket-release/${rel}:${line}`,
          `Saw: ${marker}`,
          'Wanted: kit sources reference only scripts/socket-release/ paths and the plain (non -stable) lib/sdk specifiers',
          'Fix: repoint the reference (R1/R5), or add a dated allowlist entry with the reason it is load-bearing.',
        ].join('\n'),
      )
    }
  }

  // 3. No tests ship in the payload.
  for (let i = 0, { length } = payloadFiles; i < length; i += 1) {
    const rel = payloadFiles[i]!
    if (/\.test\./.test(rel)) {
      failures.push(
        [
          'What: a test file is shipping inside the payload.',
          `Where: release-kit/payload/scripts/socket-release/${rel}`,
          `Saw: ${rel}`,
          'Wanted: tests live in test/repo/unit/release-kit/, never in the copy-in payload',
          'Fix: move the file under test/repo/.',
        ].join('\n'),
      )
    }
  }

  // 4. Pure-module import discipline.
  const pureTargets = [
    ...PURE_MODULES.map(rel => ({
      abs: path.join(PAYLOAD_ROOT, rel),
      label: `release-kit/payload/scripts/socket-release/${rel}`,
    })),
    ...SAUCE_PURE_MODULES.map(rel => ({
      abs: path.join(REPO_ROOT, rel),
      label: rel,
    })),
  ]
  for (let i = 0, { length } = pureTargets; i < length; i += 1) {
    const target = pureTargets[i]!
    let text: string
    try {
      text = readFileSync(target.abs, 'utf8')
    } catch {
      failures.push(
        [
          'What: a pure module named by the coherence check is missing.',
          `Where: ${target.label}`,
          'Saw: no such file',
          'Wanted: the module present (the pure/effects split is part of the kit contract)',
          'Fix: restore the module or update the check list in the same commit.',
        ].join('\n'),
      )
      continue
    }
    const hit = EFFECT_IMPORT.exec(text)
    if (hit) {
      failures.push(
        [
          'What: a PURE kit module imports an effects module.',
          `Where: ${target.label}`,
          `Saw: ${hit[0]}`,
          'Wanted: pure modules import no node:fs / node:child_process / node:net / node:http',
          'Fix: move the effect behind the seams module and pass data in.',
        ].join('\n'),
      )
    }
  }

  // 5. Naming law 1: only sanctioned code files live at the payload root.
  for (let i = 0, { length } = payloadFiles; i < length; i += 1) {
    const rel = payloadFiles[i]!
    if (path.dirname(rel) !== '.' || !CODE_FILE.test(rel)) {
      continue
    }
    if (!ROOT_ENTRY_ALLOWLIST.has(rel)) {
      failures.push(
        [
          'What: an unsanctioned code file lives at the payload root.',
          `Where: release-kit/payload/scripts/socket-release/${rel}`,
          `Saw: ${rel}`,
          'Wanted: root holds only the sanctioned flow entries and grandfathered residents (naming law 1)',
          'Fix: move it under its tier (publish-infra/<flow>/, bootstrap/, lib/, _shared/) or add it to ROOT_ENTRY_ALLOWLIST with the reason.',
        ].join('\n'),
      )
    }
  }

  // 6. Naming law 6: .mts everywhere; .mjs only for system-Node scripts, each
  //    TypeScript-importable one carrying a .d.mts sidecar.
  for (let i = 0, { length } = payloadFiles; i < length; i += 1) {
    const rel = payloadFiles[i]!
    if (DISALLOWED_CODE_EXT.test(rel)) {
      failures.push(
        [
          'What: a payload code file uses a non-.mts extension.',
          `Where: release-kit/payload/scripts/socket-release/${rel}`,
          `Saw: ${rel}`,
          'Wanted: .mts everywhere (naming law 6); .mjs only for system-Node scripts',
          'Fix: rename to .mts, or (for a system-Node script) to .mjs with a .d.mts sidecar.',
        ].join('\n'),
      )
      continue
    }
    if (!rel.endsWith('.mjs')) {
      continue
    }
    if (!SYSTEM_NODE_MJS.some(re => re.test(rel))) {
      failures.push(
        [
          'What: a .mjs script lives outside the sanctioned system-Node homes.',
          `Where: release-kit/payload/scripts/socket-release/${rel}`,
          `Saw: ${rel}`,
          'Wanted: .mjs only for the registry liveness gate job or a composite-action minter (naming law 6)',
          'Fix: convert it to .mts, or add its home to SYSTEM_NODE_MJS with the reason.',
        ].join('\n'),
      )
      continue
    }
    // The system-Node .mjs at the payload root is the registry liveness gate;
    // TypeScript imports it, so it needs a .d.mts sidecar. The composite-action
    // minter nested under templates/actions/ is never TypeScript-imported.
    if (path.dirname(rel) === '.') {
      const sidecar = rel.replace(/\.mjs$/, '.d.mts')
      if (!payloadFiles.includes(sidecar)) {
        failures.push(
          [
            'What: a TypeScript-importable .mjs is missing its .d.mts sidecar.',
            `Where: release-kit/payload/scripts/socket-release/${rel}`,
            `Saw: no ${sidecar}`,
            'Wanted: every .mjs imported from TypeScript carries a .d.mts sidecar (naming law 6)',
            'Fix: add the .d.mts sidecar next to the .mjs.',
          ].join('\n'),
        )
      }
    }
  }

  if (failures.length > 0) {
    logger.fail(failures.join('\n\n'))
    process.exitCode = 1
    return
  }
  logger.success(
    `release-kit is coherent — ${payloadFiles.length} payload files checked.`,
  )
}

main()
