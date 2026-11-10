/**
 * Every agent plugin this repository ships. To add an agent, write a target
 * under targets/ and list it here; generation, drift checks, formatting, the
 * socket-connect sign-in table, and the structural tests all read this list.
 */

import { claudeTarget } from './targets/claude.mts'
import { codexTarget } from './targets/codex.mts'
import { cursorTarget } from './targets/cursor.mts'
import { geminiTarget } from './targets/gemini.mts'
import { hermesTarget } from './targets/hermes.mts'
import type { PluginTarget } from './target.mts'

export const PLUGIN_TARGETS: readonly PluginTarget[] = [
  claudeTarget,
  codexTarget,
  cursorTarget,
  geminiTarget,
  hermesTarget,
]

/**
 * The shared skill doc generated from the targets' sign-in details.
 */
export const SIGN_IN_DOC = 'skills/_shared/docs/agent-sign-in.md'

export function generatedFiles(
  targets: readonly PluginTarget[] = PLUGIN_TARGETS,
): string[] {
  return [SIGN_IN_DOC, ...targets.flatMap(target => target.files)]
}

export function generatedDirs(
  targets: readonly PluginTarget[] = PLUGIN_TARGETS,
): string[] {
  return targets.flatMap(target => target.dirs)
}
