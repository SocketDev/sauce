import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { getAdapter } from '../helpers/agent-adapters/index.js'
import type { AgentAdapter } from '../helpers/agent-adapters/index.js'
import {
  buildSkillPrompt,
  cleanupTestRepo,
  copyFixture,
} from '../helpers/test-repos.js'
import { expectScoreAboveThreshold } from '../helpers/assertions.js'

describe('Dep Patch E2E', () => {
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

  it('suggests patching for lodash', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-dep-patch',
        'How do I patch the lodash vulnerabilities in this project? Use the Socket CLI tools to find the right approach.',
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['lodash', 'patch', 'version', 'upgrade', 'vulnerab'],
      0.4,
    )
  })

  it('mentions verification steps', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-dep-patch',
        "What steps should I take to fix security vulnerabilities in this project's dependencies? Read the package.json, identify the vulnerable packages, and describe the verification steps (testing, scanning, etc.) I should follow after applying patches.",
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(response, ['test', 'verify', 'scan', 'fix'], 0.4)
  })
})
