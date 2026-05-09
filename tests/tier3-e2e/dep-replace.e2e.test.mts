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

describe('Dep Replace E2E', () => {
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

  it(
    'identifies replacement strategies for a dependency',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-dep-replace',
          "Analyze the 'is-odd' package in this project and suggest replacement strategies. Do not execute any migration, just present the strategies.",
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(
        response,
        ['is-odd', 'strateg', 'replace', 'inline'],
        0.4,
      )
    },
  )

  it(
    'builds a usage map for a target dependency',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-dep-replace',
          "Build a usage map for the 'lodash' package in this project. List all files, line numbers, and specific APIs used. Do not execute any replacement.",
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(response, ['lodash', 'usage', 'import'], 0.4)
    },
  )
})
