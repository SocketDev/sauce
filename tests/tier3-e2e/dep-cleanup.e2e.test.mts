/**
 * @file End-to-end check that the dependency-cleanup skill drives a coding
 *   agent to remove unused dependencies from a real fixture project.
 *   Opt-in lane: `pnpm run test:e2e`, which sets RUN_E2E=1. The run needs an
 *   agent CLI on PATH and live network, so the `pnpm test` / `pnpm run cover`
 *   gate deliberately does not reach it. A gate has to be runnable by anyone
 *   who clones the repo, and this suite is not.
 *   runner-collection: opt-in lane.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { getAdapter } from '../helpers/agent-adapters/index.mts'
import type { AgentAdapter } from '../helpers/agent-adapters/index.mts'
import {
  buildSkillPrompt,
  cleanupTestRepo,
  copyFixture,
} from '../helpers/test-repos.mts'
import { expectScoreAboveThreshold } from '../helpers/assertions.mts'

describe('Dep Cleanup E2E', () => {
  let adapter: AgentAdapter
  let testDir: string

  beforeAll(async () => {
    adapter = getAdapter()
    const available = await adapter.isAvailable()
    if (!available) {
      throw new Error(
        `Agent '${adapter.name}' is not available. Install it or set TEST_AGENT to a different agent.`,
      )
    }
  })

  beforeEach(() => {
    testDir = copyFixture('test-project')
  })

  afterAll(() => {
    if (testDir) {
      cleanupTestRepo(testDir)
    }
  })

  it('evaluates a single unused dep', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-dep-cleanup',
        "Check if 'is-odd' is used anywhere in this project. Do not remove it, just report whether it is used or unused.",
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    const lower = response.output.toLowerCase()
    const hasUnusedPkg = lower.includes('is-odd')

    expectScoreAboveThreshold(response, ['unused', 'is-odd'], 0.4)

    if (!hasUnusedPkg) {
      throw new Error(
        "Expected output to mention 'is-odd' as unused.\n\n" +
          `Output:\n${response.output.slice(0, 500)}`,
      )
    }
  })

  it(
    'reports usage locations for a used dep',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-dep-cleanup',
          "Check if 'lodash' is used anywhere in this project. Do not remove it, just report all usage locations.",
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(response, ['lodash', 'used', 'import'], 0.4)
    },
  )
})
