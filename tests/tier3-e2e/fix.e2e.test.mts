/**
 * @file End-to-end check that the fix skill drives a coding agent to resolve
 *   reported alerts in a real fixture project.
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

describe('Fix E2E', () => {
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

  it(
    'identifies repair levels and environment',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-fix',
          'Analyze this project and describe what each repair level (conservative, cautious, full) would do. Detect the ecosystem and list the dependencies. Do not make any changes.',
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(
        response,
        ['level', 'conservative', 'cautious', 'cleanup', 'patch', 'upgrade'],
        0.4,
      )
    },
  )

  it(
    'performs conservative repair analysis',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-fix',
          'Run a conservative (Level 1) repair analysis on this project. Identify which dependencies appear unused and which patches are available. Do not actually remove or patch anything — just report what you would do.',
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(
        response,
        ['unused', 'patch', 'conservative', 'dependency', 'safe'],
        0.4,
      )
    },
  )

  it('proposes a risky change for level 2', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-fix',
        'If this project were at repair Level 2 (cautious), what single risky change would you propose? Look at the dependencies for known vulnerabilities and suggest the highest-value upgrade. Do not apply it.',
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['risky', 'approve', 'upgrade', 'lodash', 'vulnerab'],
      0.4,
    )
  })
})
