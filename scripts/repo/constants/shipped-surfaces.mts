/**
 * @file The ship-vs-scaffolding classification — the audience boundary.
 *   Consumers of this repo are NOT fleet members: shipped trees carry
 *   exclusively Socket-integration content, and fleet scaffolding
 *   (wheelhouse cascade machinery) never appears in, or is referenced
 *   from, anything a consumer installs. Every top-level tracked entry
 *   must be classified here; the shipped-content-is-consumer-clean check
 *   fails on any unclassified entry so new surfaces are a conscious call.
 */

import {
  generatedDirs,
  generatedFiles,
  PLUGIN_TARGETS,
} from '../plugins/registry.mts'

const topLevel = (rel: string): string => rel.split('/')[0]!

/**
 * Trees consumers install or copy — Socket-integration content only. Each
 * agent plugin's generated trees are added from the plugin registry.
 */
export const SHIPPED_DIRS: readonly string[] = [
  ...new Set([
    'agents',
    'examples',
    'release-kit',
    'skills',
    ...generatedDirs().map(topLevel),
  ]),
].toSorted()

/**
 * Agent-instruction trees inside a shipped root entry, declared by the plugin
 * targets. Agents read and obey these files, so the shipped-content gates
 * scan them like SHIPPED_DIRS, and shared skill sections are inlined into
 * them.
 */
export const SHIPPED_INSTRUCTION_DIRS: readonly string[] =
  PLUGIN_TARGETS.flatMap(target => target.instructionDirs ?? [])

/**
 * Consumer-facing manifests and adapters at the root: generated for the
 * harnesses consumers use, referenced by shipped docs, but not trees a
 * consumer copies wholesale. Each agent plugin's root entries come from the
 * plugin registry.
 */
export const SHIPPED_ROOT_FILES: readonly string[] = [
  ...new Set([
    '.opencode',
    'LICENSE',
    'README.md',
    ...[
      ...generatedFiles(),
      ...PLUGIN_TARGETS.flatMap(target => target.sources),
    ]
      .map(topLevel)
      .filter(entry => !SHIPPED_DIRS.includes(entry)),
  ]),
].toSorted()

/**
 * Fleet-member machinery — cascaded from the wheelhouse, never consumable.
 */
export const SCAFFOLDING_ENTRIES = [
  '.cargo',
  '.claude',
  '.config',
  '.editorconfig',
  '.env.example',
  '.git-hooks',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.husky',
  '.mcp.json',
  '.node-version',
  '.npmrc',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'AGENTS.md',
  'CLAUDE.md',
  'assets',
  'depot.json',
  'docs',
  'package.json',
  'patches',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts',
  'test',
  'tests',
  'tsconfig.json',
] as const

/**
 * Narrow carve-outs from {@link FLEET_INTERNAL_MARKERS}: an exact
 * marker/path pair whose appearance in a shipped file is load-bearing, with
 * the reason it cannot be renamed. Anything not listed here is a leak.
 */
export const SHIPPED_MARKER_ALLOWLIST = [
  {
    marker: 'socket-wheelhouse',
    paths: [
      'release-kit/payload/scripts/socket-release/_shared/playwright-law.mts',
      'release-kit/payload/scripts/socket-release/paths.mts',
      'release-kit/payload/scripts/socket-release/publish-infra/npm/browser-session.mts',
      'release-kit/payload/scripts/socket-release/publish-infra/npm/trusted-publisher-browser.mts',
    ],
    why: 'the ONE durable Chrome profile every Socket npm browser tool shares lives at ~/.config/socket-wheelhouse/staged-browser-profile; renaming it would sign every already-authenticated operator out.',
  },
] as const

/**
 * Strings whose appearance in a SHIPPED file leaks fleet internals to
 * consumers. Kept as plain substrings so the scan stays greppable.
 */
export const FLEET_INTERNAL_MARKERS = [
  '.claude/hooks/fleet',
  'docs/agents.md/fleet',
  'scripts/fleet/',
  'socket-wheelhouse',
] as const
