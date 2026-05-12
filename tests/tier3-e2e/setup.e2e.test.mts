import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { getAdapter } from '../helpers/agent-adapters/index.js'
import type { AgentAdapter } from '../helpers/agent-adapters/index.js'
import {
  buildSkillPrompt,
  cleanupTestRepo,
  copyFixture,
} from '../helpers/test-repos.js'
import { expectScoreAboveThreshold } from '../helpers/assertions.js'

describe('Setup E2E', () => {
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
    'detects GitHub Actions and suggests config',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-setup',
          'Set up Socket for this project. Detect the CI/CD system and tell me what configuration is needed.',
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(
        response,
        ['github', 'actions', 'socket', 'workflow'],
        0.4,
      )
    },
  )

  it('provides CLI installation guidance', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-setup',
        'How do I install and set up the Socket CLI for this project?',
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['npm install', 'socket', 'cli', 'version'],
      0.4,
    )
  })
})
