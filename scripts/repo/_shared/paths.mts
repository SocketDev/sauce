import path from 'node:path'

export function repoClaudeMarketplacePath(root: string): string {
  return path.join(root, '.claude-plugin', 'marketplace.json')
}

export function repoClaudePluginPath(root: string): string {
  return path.join(root, '.claude-plugin', 'plugin.json')
}
