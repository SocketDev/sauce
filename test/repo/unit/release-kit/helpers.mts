/**
 * @file Shared fakes for the release-kit suites: a canned StepContext and a
 *   recording BootstrapSeams whose every lane is data-driven — no browser,
 *   no network, no child process anywhere. Fake I/O, never logic: the fakes
 *   return canned wire payloads and the REAL classify/plan functions do all
 *   the work.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StepContext } from '../../../../release-kit/payload/scripts/socket-release/bootstrap/plan.mts'
import type {
  BootstrapSeams,
  ExecResult,
  RegistryJsonResult,
} from '../../../../release-kit/payload/scripts/socket-release/bootstrap/seams.mts'
import type { PublishingAccessRead } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/access-parse.mts'
import type { PlaceholderResult } from '../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/placeholder.mts'

export const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'release-kit',
)

export function fixture(rel: string): string {
  return readFileSync(path.join(FIXTURES, rel), 'utf8')
}

export const OK: ExecResult = { code: 0, stderr: '', stdout: '' }

export function makeCtx(
  overrides?: Partial<StepContext> | undefined,
): StepContext {
  return {
    access: 'restricted',
    apply: false,
    branch: undefined,
    channels: ['npm', 'github-release'],
    defaultBranch: 'main',
    force: false,
    nodeVersion: 'v24.0.0',
    packageName: '@socketsecurity/example',
    packageVersion: '1.0.0',
    repoRoot: '/tmp/example-repo',
    reserve: undefined,
    slug: 'SocketDev/example',
    visibility: 'private',
    yes: false,
    ...overrides,
  }
}

export interface FakeSeamsConfig {
  accessReads?: PublishingAccessRead[] | undefined
  accessWriteOk?: boolean | undefined
  exec?:
    | ((cmd: string, args: string[], cwd: string) => ExecResult | undefined)
    | undefined
  execPtyCode?: number | undefined
  files?: Record<string, string> | undefined
  identity?: boolean | undefined
  listDirs?: Record<string, string[]> | undefined
  placeholderResults?: PlaceholderResult[] | undefined
  registry?: ((url: string) => RegistryJsonResult) | undefined
  resolveDeps?: boolean | undefined
}

export interface FakeSeams {
  accessWrites: Array<{ desired: unknown; pkg: string }>
  calls: Array<{ args: string[]; cmd: string; cwd: string; kind: string }>
  placeholderCalls: Array<{ access: string; apply: boolean; names: string[] }>
  seams: BootstrapSeams
  written: Record<string, string>
}

/**
 * A fully canned BootstrapSeams. Every mutating lane records; every read
 * lane serves the configured data. Time is fixed so goldens are stable.
 */
export function fakeSeams(config?: FakeSeamsConfig | undefined): FakeSeams {
  const cfg = { __proto__: null, ...config } as FakeSeamsConfig
  const calls: FakeSeams['calls'] = []
  const written: Record<string, string> = {}
  const placeholderCalls: FakeSeams['placeholderCalls'] = []
  const accessWrites: FakeSeams['accessWrites'] = []
  const accessReads = [...(cfg.accessReads ?? [])]
  let tick = 0
  const seams: BootstrapSeams = {
    ensureNpmIdentity: async () => cfg.identity ?? true,
    exec: async (cmd, args, cwd) => {
      calls.push({ args, cmd, cwd, kind: 'exec' })
      return cfg.exec?.(cmd, args, cwd) ?? OK
    },
    execPty: async (cmd, args, cwd) => {
      calls.push({ args, cmd, cwd, kind: 'execPty' })
      return cfg.execPtyCode ?? 0
    },
    listDir: p => cfg.listDirs?.[p] ?? [],
    now: () => {
      tick += 7
      return new Date(Date.UTC(2026, 6, 31, 0, 0, 0, tick))
    },
    readFile: p => written[p] ?? cfg.files?.[p],
    readPublishingAccess: async () =>
      accessReads.shift() ?? {
        directEnabled: undefined,
        stagedEnabled: undefined,
        state: 'unknown',
      },
    registryJson: async url =>
      cfg.registry?.(url) ?? { body: { error: 'Not found' }, status: 404 },
    resolveKitDep: () => cfg.resolveDeps ?? true,
    runPlaceholder: async c => {
      placeholderCalls.push({
        access: c.access,
        apply: c.apply,
        names: c.names,
      })
      return (
        cfg.placeholderResults ?? [
          { name: c.names[0]!, status: 'published' as const },
        ]
      )
    },
    writeFile: (p, content) => {
      written[p] = content
    },
    writePublishingAccess: async (pkg, desired) => {
      accessWrites.push({ desired, pkg })
      const read = accessReads.shift() ?? {
        directEnabled: (desired as { directEnabled: boolean }).directEnabled,
        stagedEnabled: (desired as { stagedEnabled: boolean }).stagedEnabled,
        state: 'staged-only' as const,
      }
      return { ok: cfg.accessWriteOk ?? true, read }
    },
  }
  return { accessWrites, calls, placeholderCalls, seams, written }
}

/**
 * A live packument body in the install-v1 projection.
 */
export function livePackument(): RegistryJsonResult {
  return { body: JSON.parse(fixture('packument/live.json')), status: 200 }
}

export function unpublishedPackument(): RegistryJsonResult {
  return {
    body: JSON.parse(fixture('packument/unpublished-404.json')),
    status: 404,
  }
}

export function unreachableRegistry(): RegistryJsonResult {
  return { unreachable: 'connect ETIMEDOUT 104.16.0.1:443' }
}
