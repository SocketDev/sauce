import type { AgentResponse } from '../assertions.mts'

export interface RunPromptConfig {
  prompt: string
  workingDir: string
  timeoutMs?: number | undefined
}

export interface AgentAdapter {
  name: string
  isAvailable(): Promise<boolean>
  runPrompt(config: RunPromptConfig): Promise<AgentResponse>
}
