/**
 * @file Pure helpers + types backing `install-claude-plugins.mts`'s
 *   reconciler. Split out to keep the CLI entry under the 500-line soft cap —
 *   these are also the surface `scripts/test/install-claude-plugins.test.mts`
 *   exercises directly (no `claude` CLI shell-out needed).
 */

import { existsSync } from 'node:fs'
import { isObject } from '@socketsecurity/lib-stable/objects/predicates'
import path from 'node:path'
import process from 'node:process'

// Canonical marketplace identity. The repo URL is what `claude plugin
// marketplace add` resolves; the name is what Claude Code records in
// `known_marketplaces.json` and what plugins reference via `@<name>`.
export const MARKETPLACE_NAME = 'socket-wheelhouse'
export const MARKETPLACE_URL = 'https://github.com/SocketDev/socket-wheelhouse'

// Claude Code stores SHA-pinned plugin installs at a cache directory
// whose name is `<sha-12-chars>-<content-hash-8-chars>`. We parse the
// first segment to extract the pinned SHA for drift comparison.
const SHA_PINNED_DIR_NAME = /^([0-9a-f]{12})-[0-9a-f]{8,}$/

// <plugin>-<version>-<slug>.patch — version is dotted (e.g. 1.0.1); slug is
// freeform after it. Capture plugin + version to locate the cache dir.
const PATCH_FILE_NAME = /^([a-z0-9-]+)-(\d+\.\d+\.\d+)-[a-z0-9-]+\.patch$/

export interface MarketplaceListEntry {
  name: string
  source: string
  installLocation?: string | undefined
}

export interface PluginListEntry {
  id: string
  version?: string | undefined
  scope?: string | undefined
  enabled?: boolean | undefined
  installPath?: string | undefined
}

export interface MarketplacePluginSource {
  source: string
  url?: string | undefined
  path?: string | undefined
  ref?: string | undefined
  sha?: string | undefined
  commit?: string | undefined
}

export interface MarketplacePlugin {
  name: string
  source: MarketplacePluginSource
}

export interface MarketplaceManifest {
  name?: string | undefined
  plugins?: MarketplacePlugin[] | undefined
}

/**
 * Parse a plugin-patch filename of the form `<plugin>-<version>-<slug>.patch`
 * into its `{ plugin, version }`. The plugin + version map to the cache dir
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Returns
 * `undefined` for any name that doesn't match the shape (dotted semver version
 * sandwiched between a plugin name and a freeform slug). Greedy `<plugin>` is
 * disambiguated by the `\d+\.\d+\.\d+` version anchor, so a hyphenated plugin
 * name (`socket-foo`) still parses.
 */
export function parsePatchFileName(
  fileName: string,
): { plugin: string; version: string } | undefined {
  const m = PATCH_FILE_NAME.exec(fileName)
  if (!m) {
    return undefined
  }
  return { plugin: m[1]!, version: m[2]! }
}

/**
 * The single owner of the `~/.claude/plugins/` base path — Claude Code's plugin
 * home, which holds both `installed_plugins.json` (the state file) and
 * `cache/<marketplace>/<plugin>/<version>/` (the per-plugin caches). Every
 * other reference derives from this one construction (1 path, 1 reference).
 * Returns `undefined` if HOME / USERPROFILE is unresolvable.
 */
export function getPluginsDir(): string | undefined {
  const home = process.env['HOME'] ?? process.env['USERPROFILE']
  if (!home || !path.isAbsolute(home)) {
    return undefined
  }
  return path.join(home, '.claude', 'plugins')
}

/**
 * Parse the plugin's `installPath` to extract the SHA prefix it was pinned to
 * (12 chars). Returns `null` for directory installs, version-tagged installs,
 * or any path shape we don't recognize as SHA-pinned. Claude Code uses this
 * dir-name shape for ref-less pins; version-tagged pins use a dir name like
 * `1.0.1` instead — see `lookupInstalledSha` for the authoritative source.
 */
export function extractInstalledSha(
  installPath: string | undefined,
): string | undefined {
  if (!installPath) {
    return undefined
  }
  const dirName = path.basename(installPath)
  const m = SHA_PINNED_DIR_NAME.exec(dirName)
  return m ? (m[1] ?? undefined) : undefined
}

/**
 * Look up the installed `gitCommitSha` for a plugin from Claude Code's own
 * state file `~/.claude/plugins/installed_plugins.json`. This is the
 * authoritative record of which commit a plugin was installed from, regardless
 * of whether the cache dir is SHA-prefixed (`9cb4fe40-deadbeef/`) or
 * version-tagged (`1.0.1/`).
 *
 * Returns the full 40-char SHA, or `null` if the file/entry is missing or the
 * `gitCommitSha` field is absent (some plugin sources don't carry it —
 * directory installs, for example).
 */
export function lookupInstalledSha(
  installedPluginsJson: unknown,
  installId: string,
): string | undefined {
  const plugins = isObject(installedPluginsJson)
    ? installedPluginsJson['plugins']
    : undefined
  if (!isObject(plugins)) {
    return undefined
  }
  const entries = plugins[installId]
  if (!Array.isArray(entries)) {
    return undefined
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry: unknown = entries[i]
    if (!isObject(entry)) {
      continue
    }
    const sha = entry['gitCommitSha']
    if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
      return sha
    }
  }
  return undefined
}

/**
 * Find an existing install of `pluginName` that came from a marketplace _other
 * than_ ours. Plugin ids have the shape `<name>@<marketplace>`. Returns the
 * foreign install entry, or `undefined` if none.
 */
export function findForeignInstall(
  pluginName: string,
  plugins: PluginListEntry[],
  ourMarketplace: string,
): PluginListEntry | undefined {
  const ourId = `${pluginName}@${ourMarketplace}`
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const p = plugins[i]!
    if (!p.id.startsWith(`${pluginName}@`)) {
      continue
    }
    if (p.id === ourId) {
      continue
    }
    return p
  }
  return undefined
}

/**
 * Identify marketplaces that look orphaned — exist locally, aren't ours, and
 * only serve plugins our marketplace now serves canonically. Returns the
 * marketplace names; we warn the user rather than auto-remove (a dev-source
 * override is a legitimate deliberate state).
 */
export function findOrphanMarketplaces(
  marketplaces: MarketplaceListEntry[],
  ourMarketplace: string,
  ourPluginNames: Set<string>,
  plugins: PluginListEntry[],
): string[] {
  const orphans: string[] = []
  for (let i = 0, { length } = marketplaces; i < length; i += 1) {
    const mkt = marketplaces[i]!
    if (mkt.name === ourMarketplace) {
      continue
    }
    // Find every plugin installed from this marketplace.
    const installedFromHere = plugins
      .filter(p => p.id.endsWith(`@${mkt.name}`))
      .map(p => p.id.slice(0, -`@${mkt.name}`.length))
    if (installedFromHere.length === 0) {
      // No installs from this marketplace — leave it alone. The user
      // added it for a reason we can't see.
      continue
    }
    if (installedFromHere.every(name => ourPluginNames.has(name))) {
      orphans.push(mkt.name)
    }
  }
  return orphans
}

/**
 * Resolve the on-disk cache dir for a plugin pinned in our marketplace. Claude
 * Code lays caches out at
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Returns the
 * absolute path, or `undefined` if HOME is unresolvable or the dir is absent.
 */
export function resolvePluginCacheDir(
  pluginName: string,
  version: string,
): string | undefined {
  const pluginsDir = getPluginsDir()
  if (!pluginsDir) {
    return undefined
  }
  const dir = path.join(
    pluginsDir,
    'cache',
    MARKETPLACE_NAME,
    pluginName,
    version,
  )
  return existsSync(dir) ? dir : undefined
}

/**
 * Strip the leading `# @key: value` / `#` comment header from a fleet-style
 * patch, returning just the unified-diff body (everything from the first `--- `
 * line onward). Mirrors socket-btm's node-smol patch convention, where the
 * header carries provenance metadata and the apply step feeds only the diff to
 * `patch`. Returns an empty string if the file has no `--- ` line.
 */
export function stripPatchHeader(patchText: string): string {
  const idx = patchText.search(/^--- /m)
  return idx === -1 ? '' : patchText.slice(idx)
}

/**
 * Derive the sidecar dir for a patch file. A patch named `<x>.patch` may ship a
 * companion `<x>.files/` directory whose tree mirrors the plugin cache root
 * (e.g. `<x>.files/scripts/lib/read-stdin-sync.mjs` → `<cache>/scripts/lib/…`).
 * The fleet "smallest patch footprint" rule prefers moving substantial logic
 * into such a sidecar module so the diff itself stays an import + call-site
 * swap, rather than inlining a 30-line function body. Returns the dir path
 * (whether or not it exists — caller checks).
 */
export function patchSidecarDir(patchPath: string): string {
  return patchPath.replace(/\.patch$/, '.files')
}
