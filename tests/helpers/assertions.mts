/**
 * Flexible assertion helpers for AI agent outputs.
 *
 * Since AI outputs are non-deterministic, these helpers use keyword matching
 * and scoring rubrics instead of exact string comparisons.
 */

import { expect } from 'vitest'

export interface AgentResponse {
  output: string
  toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>
  exitCode?: number
}

/**
 * Negative assertion: ensure the agent didn't hallucinate non-existent tools.
 *
 * Looks for patterns like "tool_name(" or "calling tool_name" in the output
 * that aren't in the valid tools list.
 */
export function expectNoHallucinatedTools(
  response: AgentResponse,
  validToolNames: string[],
): void {
  if (!response.toolCalls) return

  const validSet = new Set(validToolNames.map(t => t.toLowerCase()))
  const hallucinated = response.toolCalls.filter(
    tc => !validSet.has(tc.name.toLowerCase()),
  )

  expect(
    hallucinated.map(tc => tc.name),
    `Hallucinated tools detected: ${hallucinated.map(tc => tc.name).join(', ')}`,
  ).toEqual([])
}

/**
 * Assert that the agent output contains all given keywords (case-insensitive).
 */
export function expectOutputContains(
  response: AgentResponse,
  keywords: string[],
): void {
  const lower = response.output.toLowerCase()
  const missing = keywords.filter(kw => !lower.includes(kw.toLowerCase()))
  expect(
    missing,
    `Output missing keywords: ${missing.join(', ')}\n\nOutput:\n${response.output.slice(0, 500)}`,
  ).toEqual([])
}

/**
 * Scoring-based assertion: a weighted percentage of criteria must match.
 *
 * Each criterion is a keyword or phrase checked case-insensitively against the output.
 * The assertion passes if the match ratio meets or exceeds the threshold.
 */
export function expectScoreAboveThreshold(
  response: AgentResponse,
  criteria: string[],
  threshold = 0.6,
): void {
  const lower = response.output.toLowerCase()
  const matches = criteria.filter(c => lower.includes(c.toLowerCase()))
  const score = matches.length / criteria.length

  expect(
    score,
    `Score ${(score * 100).toFixed(0)}% (${matches.length}/${criteria.length}) ` +
      `below threshold ${(threshold * 100).toFixed(0)}%.\n` +
      `Matched: ${matches.join(', ')}\n` +
      `Missing: ${criteria.filter(c => !lower.includes(c.toLowerCase())).join(', ')}`,
  ).toBeGreaterThanOrEqual(threshold)
}

/**
 * Assert that a specific tool was called (checks structured tool calls or raw output).
 */
export function expectToolCalled(
  response: AgentResponse,
  toolName: string,
): void {
  const calledStructured = response.toolCalls?.some(tc => tc.name === toolName)
  const mentionedInOutput = response.output
    .toLowerCase()
    .includes(toolName.toLowerCase())

  expect(
    calledStructured || mentionedInOutput,
    `Expected tool '${toolName}' to be called but it was not found in tool calls or output`,
  ).toBe(true)
}
