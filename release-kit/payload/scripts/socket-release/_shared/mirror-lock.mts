/**
 * @file Mirror-lock shim. In the wheelhouse, lockstep mirrors are read-only
 *   files a cascade owns; writing one requires lifting a chmod lock first.
 *   A consumer repo has no lockstep mirrors, so every lift is a no-op and a
 *   write is just a write. The export surface is IDENTICAL to the fleet
 *   module on purpose: the ported engine files import `writeThroughMirrorLock`
 *   unchanged (R3), and a future consumer that DOES grow a mirror system
 *   swaps this file without touching a single importer.
 */

import { writeFileSync } from 'node:fs'

/**
 * No-op in a consumer repo: nothing here is chmod-locked by a cascade.
 */
export async function liftMirrorLock(targetPath: string): Promise<void> {
  void targetPath
}

/**
 * Pass-through: run `fn` with no lock to lift.
 */
export async function withMirrorLockLifted<T>(
  filePath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  void filePath
  return await fn()
}

/**
 * No-op sync counterpart of {@link liftMirrorLock}.
 */
export function liftMirrorLockSync(filePath: string): void {
  void filePath
}

/**
 * Pass-through sync counterpart of {@link withMirrorLockLifted}.
 */
export function withMirrorLockLiftedSync<T>(filePath: string, fn: () => T): T {
  void filePath
  return fn()
}

/**
 * Write a file that may be a lockstep mirror upstream. Here it is a plain
 * write — the indirection exists so importers never branch on repo kind.
 */
export function writeThroughMirrorLock(
  filePath: string,
  content: string,
): void {
  writeFileSync(filePath, content, 'utf8')
}
