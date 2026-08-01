/**
 * @file Repo-root resolution for the release kit. A consumer repo needs
 *   exactly one fact: where its root is. The kit always installs at
 *   `<repo>/scripts/socket-release/`, so the root is two directories up from
 *   this file — no `process.cwd()`, no upward `package.json` hunt, no
 *   dependence on where the operator's shell happened to be. Anchoring on
 *   `import.meta.url` is what makes every kit CLI runnable from any cwd.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve the consumer repo root from this module's own location. The kit
 * lives exactly two levels below the root (`<root>/scripts/socket-release/`).
 */
export function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/**
 * The consumer repo root. Computed once at module load; every kit CLI reads
 * paths relative to this instead of the process cwd.
 */
export const REPO_ROOT = resolveRepoRoot()
