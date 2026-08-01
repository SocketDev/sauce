/**
 * @file Bootstrap state file — a REPORTING CACHE of step receipts, never
 *   authority (every step re-detects live before trusting anything here;
 *   deleting the file loses only history). Receipts are keyed to a
 *   `contextKey` derived from the repo slug + package name so a changed
 *   remote or subject invalidates every receipt loudly instead of resuming
 *   against the wrong package. Parsing/serialization is pure; fs is
 *   confined to `loadState`/`saveState`.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { KitError } from './render.mts'
import type { StepId, StepReceipt } from './plan.mts'

/**
 * Repo-relative state file location (gitignored via the kit's gitignore
 * block: `.cache/`).
 */
export const STATE_RELATIVE_PATH = '.cache/socket-release/bootstrap-state.json'

export interface BootstrapState {
  contextKey: string
  package: { name: string; version: string }
  receipts: Partial<Record<StepId, StepReceipt>>
  repo: { root: string; slug: string }
  schemaVersion: 1
}

/**
 * The receipt-invalidation key: same slug + same package name, or every
 * receipt is void.
 */
export function contextKey(slug: string, packageName: string): string {
  return createHash('sha256').update(`${slug} ${packageName}`).digest('hex')
}

/**
 * A fresh state for `expectedKey`.
 */
export function freshState(config: {
  expectedKey: string
  packageName: string
  packageVersion: string
  root: string
  slug: string
}): BootstrapState {
  const cfg = { __proto__: null, ...config } as typeof config
  return {
    contextKey: cfg.expectedKey,
    package: { name: cfg.packageName, version: cfg.packageVersion },
    receipts: {},
    repo: { root: cfg.root, slug: cfg.slug },
    schemaVersion: 1,
  }
}

/**
 * Parse a state file. Refuses (usage, exit 2) on a foreign schemaVersion, a
 * contextKey that no longer matches the resolved repo/package, or corrupted
 * JSON — a corrupted file must never silently read as fresh state.
 */
export function parseState(
  raw: string,
  expectedKey: string,
  filePath: string,
): BootstrapState {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new KitError(
      {
        fix: 'run with --reset to discard the corrupted state file (receipts are history only), then re-run — every step re-detects live state.',
        saw: 'unparseable JSON',
        wanted: 'a schemaVersion-1 bootstrap state document',
        what: 'Bootstrap state file is corrupted.',
        where: filePath,
      },
      2,
      { cause: e },
    )
  }
  const doc = parsed as Partial<BootstrapState> | null
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 1) {
    throw new KitError(
      {
        fix: 'run with --reset to discard it — receipts are history only.',
        saw: `schemaVersion ${String(doc && typeof doc === 'object' ? doc.schemaVersion : doc)}`,
        wanted: 'schemaVersion 1',
        what: 'Bootstrap state file has a foreign schema.',
        where: filePath,
      },
      2,
    )
  }
  if (doc.contextKey !== expectedKey) {
    throw new KitError(
      {
        fix: 'run with --reset — the state belongs to a different repo/package context.',
        saw: `contextKey ${String(doc.contextKey)}`,
        wanted: `contextKey ${expectedKey} (sha256 of "<slug> <package>")`,
        what: 'Bootstrap state file belongs to another context.',
        where: filePath,
      },
      2,
    )
  }
  return {
    contextKey: doc.contextKey,
    package: doc.package ?? { name: '', version: '' },
    receipts: doc.receipts ?? {},
    repo: doc.repo ?? { root: '', slug: '' },
    schemaVersion: 1,
  }
}

/**
 * Serialize with a trailing newline (fleet file hygiene).
 */
export function serializeState(state: BootstrapState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

/**
 * A copy of `state` with `step`'s receipt replaced. Pure.
 */
export function withReceipt(
  state: BootstrapState,
  step: StepId,
  receipt: StepReceipt,
): BootstrapState {
  return {
    ...state,
    receipts: { ...state.receipts, [step]: receipt },
  }
}

/**
 * Load the state for a context: absent file → fresh state; present →
 * parsed + validated (throws the §5 usage refusal on mismatch).
 */
export function loadState(config: {
  expectedKey: string
  packageName: string
  packageVersion: string
  root: string
  slug: string
}): BootstrapState {
  const cfg = { __proto__: null, ...config } as typeof config
  const filePath = path.join(cfg.root, STATE_RELATIVE_PATH)
  if (!fs.existsSync(filePath)) {
    return freshState(cfg)
  }
  return parseState(
    fs.readFileSync(filePath, 'utf8'),
    cfg.expectedKey,
    filePath,
  )
}

/**
 * Persist the state (apply mode only — plan mode writes nothing, not even
 * this file).
 */
export function saveState(root: string, state: BootstrapState): void {
  const filePath = path.join(root, STATE_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, serializeState(state))
}

/**
 * `--reset`: delete the state file. Receipts are history only, so this can
 * never lose real progress.
 */
export function resetState(root: string): boolean {
  const filePath = path.join(root, STATE_RELATIVE_PATH)
  if (!fs.existsSync(filePath)) {
    return false
  }
  fs.rmSync(filePath, { force: true })
  return true
}
