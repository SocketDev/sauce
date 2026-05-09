import { describe, it, beforeAll } from 'vitest'
import {
  getAdapter,
  type AgentAdapter,
} from '../helpers/agent-adapters/index.js'
import { buildSkillPrompt } from '../helpers/test-repos.js'
import {
  expectOutputContains,
  expectScoreAboveThreshold,
  expectNoHallucinatedTools,
} from '../helpers/assertions.js'

describe('Inspect E2E', () => {
  let adapter: AgentAdapter

  beforeAll(async () => {
    adapter = getAdapter()
    const available = await adapter.isAvailable()
    if (!available) {
      throw new Error(
        `Agent '${adapter.name}' is not available. Install it or set TEST_AGENT to a different agent.`,
      )
    }
  })

  it(
    'reviews lodash and provides security info',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-inspect',
          "Review the npm package 'lodash'. Try using `pnpm dlx socket npm/lodash` to look up its Socket score. If the CLI command fails, still provide a review based on what you know about lodash's security posture, known vulnerabilities (especially in versions before 4.17.21), and maintenance status.",
        ),
        workingDir: process.cwd(),
        timeoutMs: 240_000,
      })

      expectScoreAboveThreshold(
        response,
        ['lodash', 'security', 'vulnerab', 'version', 'npm'],
        0.4,
      )
    },
  )

  it('reviews express and assesses health', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-inspect',
        "Review the npm package 'express'. Try using `pnpm dlx socket npm/express` to look up its Socket score. If the CLI command fails, still provide a review based on what you know about express's security posture, quality, and dependency footprint.",
      ),
      workingDir: process.cwd(),
      timeoutMs: 240_000,
    })

    expectOutputContains(response, ['express'])
    expectScoreAboveThreshold(
      response,
      ['express', 'security', 'quality', 'dependencies', 'npm', 'web'],
      0.4,
    )
  })
})
