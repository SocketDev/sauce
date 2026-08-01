/**
 * @file Scenario builders for the in-process bootstrap integration runs:
 *   an installed npm-lib-shaped consumer served entirely through fake seams
 *   (files, exec router, canned registry), so a full `runBootstrap` executes
 *   with no browser, no network, no child process. The SAME builders
 *   generate the committed run goldens (test/repo/unit/release-kit/fixtures/
 *   release-kit/run/*.golden.json) so scenario and golden can never drift.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  BootstrapSeams,
  ExecResult,
} from '../../../../release-kit/payload/scripts/socket-release/bootstrap/seams.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAYLOAD = path.join(
  HERE,
  '../../../../release-kit/payload/scripts/socket-release',
)
const FIXTURES = path.join(HERE, '../../unit/release-kit/fixtures/release-kit')

export const ROOT = '/tmp/npm-lib'

function payloadFile(rel: string): string {
  return readFileSync(path.join(PAYLOAD, rel), 'utf8')
}

export function runFixture(rel: string): string {
  return readFileSync(path.join(FIXTURES, rel), 'utf8')
}

export type RegistryState = 'live' | 'unclaimed' | 'unreachable'
export type StageState = 'auth-dead' | 'empty' | 'staged'

export interface ScenarioConfig {
  registry?: RegistryState | undefined
  stage?: StageState | undefined
  trust?: 'absent' | 'auth-died' | 'conforms' | undefined
  workflowsInstalled?: boolean | undefined
}

export interface Scenario {
  calls: Array<{ args: string[]; cmd: string; kind: string }>
  placeholderCalls: Array<{ access: string; apply: boolean; names: string[] }>
  seams: BootstrapSeams
}

/**
 * A fully fake consumer: the npm-lib example installed with channels
 * npm,github-release, everything green on the GitHub side, with the npm
 * side's registry/stage/trust state per config.
 */
export function buildScenario(config?: ScenarioConfig | undefined): Scenario {
  const cfg = { __proto__: null, ...config } as ScenarioConfig
  const registry = cfg.registry ?? 'unclaimed'
  const stage = cfg.stage ?? 'empty'
  const trust = cfg.trust ?? 'absent'
  const workflowsInstalled = cfg.workflowsInstalled ?? true

  const npmTemplate = payloadFile('templates/workflows/npm-publish.yml')
  const ghrTemplate = payloadFile('templates/workflows/github-release.yml')
  const files: Record<string, string> = {
    [path.join(ROOT, '.config/socket-release.json')]: JSON.stringify({
      channels: ['npm', 'github-release'],
      npm: { access: 'restricted', distTag: 'latest' },
      schemaVersion: 1,
    }),
    [path.join(ROOT, '.gitignore')]:
      'node_modules/\n# socket-release-kit\n.cache/\n',
    [path.join(ROOT, 'package.json')]: JSON.stringify({
      files: ['dist'],
      name: '@socketsecurity/example-lib',
      packageManager: 'pnpm@11.17.0',
      publishConfig: { access: 'restricted' },
      scripts: {
        build: 'echo build',
        prepublishOnly:
          "echo 'ERROR: publish via the socket-release kit (scripts/socket-release)' && exit 1",
        release: 'node scripts/socket-release/bootstrap.mts',
        'release:npm': 'node scripts/socket-release/npm-publish.mts',
        'release:status': 'node scripts/socket-release/bootstrap.mts --status',
      },
      version: '1.0.0',
    }),
    [path.join(
      ROOT,
      'scripts/socket-release/templates/workflows/github-release.yml',
    )]: ghrTemplate,
    [path.join(
      ROOT,
      'scripts/socket-release/templates/workflows/npm-publish.yml',
    )]: npmTemplate,
  }
  if (workflowsInstalled) {
    files[path.join(ROOT, '.github/workflows/npm-publish.yml')] = npmTemplate
    files[path.join(ROOT, '.github/workflows/github-release.yml')] = ghrTemplate
  }

  const envDoc = JSON.parse(runFixture('gh-env/restricted.json')) as {
    environments: Array<Record<string, unknown>>
  }
  envDoc.environments.push({
    ...envDoc.environments[0]!,
    name: 'github-release',
  })
  const envList = JSON.stringify(envDoc)
  const policies = runFixture('gh-env/restricted-policies.json')

  const calls: Scenario['calls'] = []
  const placeholderCalls: Scenario['placeholderCalls'] = []
  let tick = 0

  const execRouter = (cmd: string, args: string[]): ExecResult => {
    const joined = `${cmd} ${args.join(' ')}`
    if (joined === 'git remote get-url origin') {
      return {
        code: 0,
        stderr: '',
        stdout: 'https://github.com/SocketDev/example-lib.git\n',
      }
    }
    if (joined === 'gh api repos/SocketDev/example-lib') {
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          default_branch: 'main',
          private: true,
          visibility: 'private',
        }),
      }
    }
    if (joined === 'gh auth status') {
      return { code: 0, stderr: '', stdout: 'Logged in to github.com\n' }
    }
    if (joined === 'pnpm help stage') {
      return { code: 0, stderr: '', stdout: 'Usage: pnpm stage <cmd>\n' }
    }
    if (joined === 'npm trust --help') {
      return { code: 0, stderr: '', stdout: 'npm trust\n' }
    }
    if (joined === 'pnpm stage list --json') {
      if (stage === 'auth-dead') {
        return {
          code: 1,
          stderr: '',
          stdout: runFixture('stage-list/auth-failed.txt'),
        }
      }
      const list =
        stage === 'staged'
          ? runFixture('stage-list/two-staged.txt').replaceAll(
              '@socketsecurity/example',
              '@socketsecurity/example-lib',
            )
          : runFixture('stage-list/empty.txt')
      return { code: 0, stderr: '', stdout: list }
    }
    if (cmd === 'npm' && args[0] === 'trust' && args[1] === 'list') {
      if (trust === 'auth-died') {
        return {
          code: 1,
          stderr: '',
          stdout: runFixture('trust-list/auth-died.txt'),
        }
      }
      if (trust === 'conforms') {
        return {
          code: 0,
          stderr: '',
          stdout: runFixture('trust-list/conforms.json').replaceAll(
            'SocketDev/example',
            'SocketDev/example-lib',
          ),
        }
      }
      return {
        code: 0,
        stderr: '',
        stdout: 'No trusted publishers configured for this package.\n',
      }
    }
    if (
      joined.includes('/environments') &&
      joined.includes('deployment-branch-policies')
    ) {
      return { code: 0, stderr: '', stdout: policies }
    }
    if (joined.endsWith('/environments')) {
      return { code: 0, stderr: '', stdout: envList }
    }
    if (joined.includes('/contents/.github/workflows/')) {
      return workflowsInstalled
        ? { code: 0, stderr: '', stdout: '{}' }
        : { code: 1, stderr: 'HTTP 404', stdout: '' }
    }
    return { code: 0, stderr: '', stdout: '' }
  }

  const seams: BootstrapSeams = {
    ensureNpmIdentity: async () => true,
    exec: async (cmd, args) => {
      calls.push({ args, cmd, kind: 'exec' })
      return execRouter(cmd, args)
    },
    execPty: async (cmd, args) => {
      calls.push({ args, cmd, kind: 'execPty' })
      return 0
    },
    listDir: p =>
      p.endsWith('.github/workflows') && workflowsInstalled
        ? ['github-release.yml', 'npm-publish.yml']
        : [],
    now: () => {
      tick += 7
      return new Date(Date.UTC(2026, 6, 31, 0, 0, 0, tick))
    },
    readFile: p => files[p],
    readPublishingAccess: async () => ({
      directEnabled: registry === 'live' ? false : undefined,
      stagedEnabled: registry === 'live' ? true : undefined,
      state: registry === 'live' ? 'staged-only' : 'unknown',
    }),
    registryJson: async () => {
      if (registry === 'unreachable') {
        return { unreachable: 'connect ETIMEDOUT 104.16.0.1:443' }
      }
      if (registry === 'live') {
        return {
          body: JSON.parse(runFixture('packument/live.json')),
          status: 200,
        }
      }
      return {
        body: JSON.parse(runFixture('packument/unpublished-404.json')),
        status: 404,
      }
    },
    resolveKitDep: () => true,
    runPlaceholder: async c => {
      placeholderCalls.push({
        access: c.access,
        apply: c.apply,
        names: c.names,
      })
      return [{ name: c.names[0]!, status: 'published' as const }]
    },
    writeFile: (p, content) => {
      files[p] = content
    },
    writePublishingAccess: async (_pkg, desired) => ({
      ok: true,
      read: {
        directEnabled: (desired as { directEnabled: boolean }).directEnabled,
        stagedEnabled: (desired as { stagedEnabled: boolean }).stagedEnabled,
        state: 'staged-only' as const,
      },
    }),
  }
  return { calls, placeholderCalls, seams }
}

/**
 * Normalize a run document for golden comparison: only the timing field
 * varies run-to-run (the receipt `at` timestamps come from the fake clock).
 */
export function normalizeRunDoc(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (key, value: unknown) =>
      key === 'durationMs'
        ? 0
        : key === 'at'
          ? '<at>'
          : key === 'saw' &&
              typeof value === 'string' &&
              /^v\d+\.\d+\.\d+$/.test(value)
            ? '<node-version>'
            : value,
    ),
  )
}
