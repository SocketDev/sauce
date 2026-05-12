import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { getAdapter } from '../helpers/agent-adapters/index.js'
import type { AgentAdapter } from '../helpers/agent-adapters/index.js'
import {
  buildSkillPrompt,
  cleanupTestRepo,
  copyFixture,
} from '../helpers/test-repos.js'
import {
  expectOutputContains,
  expectScoreAboveThreshold,
} from '../helpers/assertions.js'

describe('Dep Upgrade E2E', () => {
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

  it('discovers vulns and suggests updates', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-dep-upgrade',
        "Read this project's package.json and identify which dependencies have known vulnerabilities. lodash 4.17.20 is known to have CVEs — what version should it be updated to? Suggest safe upgrade versions for any vulnerable packages. Do not run socket fix. You can use npm audit if available, but primarily rely on reading the package.json and your knowledge of CVEs.",
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['lodash', 'vulnerab', 'upgrade', 'fix', 'version'],
      0.4,
    )
  })

  it('identifies lodash upgrade path', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-dep-upgrade',
        'What version should lodash be updated to for security? Try `pnpm exec socket npm/lodash` to check, but if the command fails, use your knowledge of lodash CVEs to recommend a safe version.',
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectOutputContains(response, ['lodash'])
    expectScoreAboveThreshold(
      response,
      ['lodash', 'version', 'upgrade', 'upgrade', 'fix', 'security'],
      0.4,
    )
  })
})
