import type { AgentResponse } from '../assertions.js'

export interface RunPromptOptions {
  prompt: string
  workingDir: string
  timeoutMs?: number
}

export interface AgentAdapter {
  name: string
  isAvailable(): Promise<boolean>
  runPrompt(opts: RunPromptOptions): Promise<AgentResponse>
}
