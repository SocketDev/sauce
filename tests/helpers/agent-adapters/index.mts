import type { AgentAdapter } from './types.js'
import { ClaudeCodeAdapter } from './claude-code.js'
import { CodexAdapter } from './codex.js'
import { GeminiAdapter } from './gemini.js'

const adapters: Record<string, () => AgentAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  codex: () => new CodexAdapter(),
  gemini: () => new GeminiAdapter(),
}

/**
 * Get an agent adapter by name.
 * Defaults to the TEST_AGENT environment variable, or "claude-code".
 */
export function getAdapter(name?: string): AgentAdapter {
  const agentName = name ?? process.env.TEST_AGENT ?? 'claude-code'
  const factory = adapters[agentName]
  if (!factory) {
    throw new Error(
      `Unknown agent '${agentName}'. Available: ${Object.keys(adapters).join(', ')}`,
    )
  }
  return factory()
}

export type { AgentAdapter, RunPromptOptions } from './types.js'
