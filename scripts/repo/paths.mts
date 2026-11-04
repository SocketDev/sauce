/**
 * @file Repo-owned path constants. Each repo path is constructed once here and
 *   imported where it is needed.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the repository root.
 */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

/**
 * Absolute path to the repo's scratch cache directory (git-ignored).
 */
export const REPO_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'repo')

export function repoClaudeMarketplacePath(root: string): string {
  return path.join(root, '.claude-plugin', 'marketplace.json')
}

export function repoClaudePluginPath(root: string): string {
  return path.join(root, '.claude-plugin', 'plugin.json')
}

export function repoGithubWorkflowsPath(root: string): string {
  return path.join(root, '.github', 'workflows')
}

export function repoCodexMarketplacePath(root: string): string {
  return path.join(root, '.agents', 'plugins', 'marketplace.json')
}

export function repoCodexMcpPath(root: string): string {
  return path.join(root, 'skills', '.codex-plugin', 'mcp.json')
}

export function repoCodexPluginPath(root: string): string {
  return path.join(root, 'skills', '.codex-plugin', 'plugin.json')
}
