/**
 * @file The ship-vs-scaffolding classification — the audience boundary.
 *   Consumers of this repo are NOT fleet members: shipped trees carry
 *   exclusively Socket-integration content, and fleet scaffolding
 *   (wheelhouse cascade machinery) never appears in, or is referenced
 *   from, anything a consumer installs. Every top-level tracked entry
 *   must be classified here; the shipped-content-is-consumer-clean check
 *   fails on any unclassified entry so new surfaces are a conscious call.
 */

/**
 * Trees consumers install or copy — Socket-integration content only.
 */
export const SHIPPED_DIRS = ['agents', 'skills'] as const

/**
 * Consumer-facing manifests and adapters at the root: generated for the
 * harnesses consumers use, referenced by shipped docs, but not trees a
 * consumer copies wholesale.
 */
export const SHIPPED_ROOT_FILES = [
  '.claude-plugin',
  '.cursor-plugin',
  '.opencode',
  'gemini-extension.json',
  'LICENSE',
  'README.md',
] as const

/**
 * Fleet-member machinery — cascaded from the wheelhouse, never consumable.
 */
export const SCAFFOLDING_ENTRIES = [
  '.claude',
  '.config',
  '.editorconfig',
  '.git-hooks',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.husky',
  '.mcp.json',
  '.node-version',
  '.npmrc',
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
 * Strings whose appearance in a SHIPPED file leaks fleet internals to
 * consumers. Kept as plain substrings so the scan stays greppable.
 */
export const FLEET_INTERNAL_MARKERS = [
  '.claude/hooks/fleet',
  'docs/agents.md/fleet',
  'scripts/fleet/',
  'socket-wheelhouse',
] as const
