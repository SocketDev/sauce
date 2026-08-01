import type { AgentAdapter } from './types.mts'
import { ClaudeCodeAdapter } from './claude-code.mts'
import { CodexAdapter } from './codex.mts'
import { GeminiAdapter } from './gemini.mts'

const adapters: Record<string, () => AgentAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  codex: () => new CodexAdapter(),
  gemini: () => new GeminiAdapter(),
}

/**
 * Get an agent adapter by name.
 * Defaults to the TEST_AGENT environment variable, or "claude-code".
 */
export function getAdapter(name?: string | undefined): AgentAdapter {
  const agentName = name ?? process.env['TEST_AGENT'] ?? 'claude-code'
  const factory = adapters[agentName]
  if (!factory) {
    throw new Error(
      `Unknown agent '${agentName}'. Available: ${Object.keys(adapters).join(', ')}`,
    )
  }
  return factory()
}

export type { AgentAdapter, RunPromptConfig } from './types.mts'
