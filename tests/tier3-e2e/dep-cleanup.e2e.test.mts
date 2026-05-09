import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  getAdapter,
  type AgentAdapter,
} from '../helpers/agent-adapters/index.js'
import {
  copyFixture,
  cleanupTestRepo,
  buildSkillPrompt,
} from '../helpers/test-repos.js'
import { expectScoreAboveThreshold } from '../helpers/assertions.js'

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
    if (testDir) cleanupTestRepo(testDir)
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
