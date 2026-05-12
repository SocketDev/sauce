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

describe('Scan E2E', () => {
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

  it('scans project and reports findings', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-scan',
        "Scan this project's dependencies for security risks. Use the Socket CLI to create a scan and report the findings.",
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['lodash', 'vulnerab', 'security', 'scan', 'risk'],
      0.4,
    )
  })

  it(
    'identifies specific vulnerable package',
    { timeout: 300_000 },
    async () => {
      const response = await adapter.runPrompt({
        prompt: buildSkillPrompt(
          'socket-scan',
          'Use the Socket CLI to check if any dependencies have known CVEs or vulnerabilities.',
        ),
        workingDir: testDir,
        timeoutMs: 240_000,
      })

      expectOutputContains(response, ['lodash'])
      expectScoreAboveThreshold(
        response,
        ['lodash', 'CVE', 'vulnerab', 'version'],
        0.4,
      )
    },
  )

  it('generates a compliance report', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-scan',
        "Audit the licenses of all dependencies in this project. Read the package.json and classify each dependency's license. Produce a compliance summary showing license types and any issues.",
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['license', 'MIT', 'compliance', 'lodash', 'express'],
      0.4,
    )
  })

  it('identifies SBOM output format', { timeout: 300_000 }, async () => {
    const response = await adapter.runPrompt({
      prompt: buildSkillPrompt(
        'socket-scan',
        'What SBOM formats can you generate for this project? List the dependencies and describe how you would produce a CycloneDX or SPDX SBOM.',
      ),
      workingDir: testDir,
      timeoutMs: 240_000,
    })

    expectScoreAboveThreshold(
      response,
      ['SBOM', 'CycloneDX', 'SPDX', 'dependencies'],
      0.4,
    )
  })
})
