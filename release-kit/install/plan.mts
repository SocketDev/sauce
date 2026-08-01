/**
 * @file PURE install planning: given the selected manifest entries and a
 *   map of the target's current file hashes, classify every file as
 *   copy / skip-identical / conflict. The planner never touches the
 *   filesystem — `install/seams.mts` gathers `targetReads` and performs
 *   the copies; this module only decides.
 */

import type { ManifestEntry } from './manifest.mts'

export type InstallAction = 'conflict' | 'copy' | 'skip-identical'

export interface PlannedFile {
  action: InstallAction
  path: string
  sha256: string
  sawSha256?: string | undefined
}

export interface InstallPlan {
  conflicts: PlannedFile[]
  copies: PlannedFile[]
  identical: PlannedFile[]
}

/**
 * Classify every selected entry against the target's current hashes:
 * absent → copy; identical hash → skip-identical; differing hash →
 * conflict (the installer refuses per file unless `--force`).
 */
export function planInstall(config: {
  entries: readonly ManifestEntry[]
  targetReads: ReadonlyMap<string, string | undefined>
}): InstallPlan {
  const cfg = { __proto__: null, ...config } as typeof config
  const plan: InstallPlan = { conflicts: [], copies: [], identical: [] }
  for (let i = 0, { length } = cfg.entries; i < length; i += 1) {
    const entry = cfg.entries[i]!
    const saw = cfg.targetReads.get(entry.path)
    if (saw === undefined) {
      plan.copies.push({
        action: 'copy',
        path: entry.path,
        sha256: entry.sha256,
      })
    } else if (saw === entry.sha256) {
      plan.identical.push({
        action: 'skip-identical',
        path: entry.path,
        sha256: entry.sha256,
      })
    } else {
      plan.conflicts.push({
        action: 'conflict',
        path: entry.path,
        sawSha256: saw,
        sha256: entry.sha256,
      })
    }
  }
  return plan
}
