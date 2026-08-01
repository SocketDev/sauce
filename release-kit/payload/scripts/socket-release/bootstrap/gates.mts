/**
 * @file The bootstrap's gate catalog: every human gate any kit flow can
 *   render, composed from the factories in `_shared/human-gate.mts` — never
 *   hand-written prose. `CANONICAL_GATES` instantiates all EIGHT factories
 *   with representative arguments so the mirror test asserts the 6-line
 *   fleet shape (🖐  HUMAN GATE — <name> [i/N] / Need / Mind / A) You /
 *   B) Me / Then) over the complete catalog in one place. Pure data +
 *   re-exports; no I/O.
 */

import {
  approveGate,
  browserSessionGate,
  ghEnvGate,
  npmAuthGate,
  placeholderPromoteGate,
  pushGrantGate,
  reserveNameGate,
  webAuthApproveGate,
} from '../_shared/human-gate.mts'
import type { HumanGate } from '../_shared/human-gate.mts'
import { NPM_APPROVE_COMMAND } from '../publish-infra/npm/shared.mts'

export {
  approveGate,
  browserSessionGate,
  ghEnvGate,
  npmAuthGate,
  placeholderPromoteGate,
  pushGrantGate,
  reserveNameGate,
  webAuthApproveGate,
}
export type { HumanGate }

/**
 * All eight canonical gate factories instantiated with representative
 * arguments — the mirror test's single subject. Order matches the
 * README's gate catalog.
 */
export const CANONICAL_GATES: ReadonlyArray<{
  gate: HumanGate
  id: string
}> = [
  {
    gate: npmAuthGate(
      '/tmp/example-repo',
      'the bootstrap resumes at the blocked step.',
    ),
    id: 'npm-auth',
  },
  {
    gate: pushGrantGate(
      'push it: example',
      'the release commit',
      'the push proceeds.',
    ),
    id: 'push-grant',
  },
  {
    gate: approveGate(
      NPM_APPROVE_COMMAND,
      '/tmp/example-repo',
      'the staged publish promotes and the tag/release cut follows.',
    ),
    id: 'publish-approve',
  },
  {
    gate: browserSessionGate(
      'the staged-tarball byte check needs the signed-in browser session.',
      'sign in to npm in the Chrome window the tool opened.',
      'say "signed in" once the npm session is live and I resume the read.',
      'the byte verification resumes.',
    ),
    id: 'browser-session',
  },
  {
    gate: reserveNameGate(
      '@example/pkg',
      'restricted',
      'the bootstrap resumes at placeholder.',
    ),
    id: 'reserve-name',
  },
  {
    gate: placeholderPromoteGate(
      '@example/pkg',
      'stage-0001',
      'the bootstrap resumes at placeholder.',
    ),
    id: 'placeholder-promote',
  },
  {
    gate: webAuthApproveGate(
      'the placeholder publish',
      'the publish completes and the bootstrap continues.',
    ),
    id: 'web-auth-approve',
  },
  {
    gate: ghEnvGate(
      'ExampleOwner/example',
      'npm-publish',
      'the bootstrap resumes at github-env.',
    ),
    id: 'gh-env',
  },
]
