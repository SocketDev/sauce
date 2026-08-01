/**
 * @file The ONLY place bootstrap effects live. Every step's `read`/`apply`
 *   body drives these seams; `resolveSeams()` returns the real
 *   implementations (delegating to the ported engine — spawn-backed exec,
 *   `httpRequest` for registry reads, the sanctioned browser session for the
 *   publishing-access lane, `runPlaceholder` for the one-time reservation),
 *   and every test injects fakes. No step body calls `node:fs`,
 *   `node:child_process`, `fetch`, or playwright directly — that discipline
 *   is what makes the whole state machine testable without a browser, a
 *   registry, or a network socket.
 */

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { httpRequest } from '@socketsecurity/lib/http-request'
import { errorMessage } from '@socketsecurity/lib/errors/message'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { ensureNpmIdentity } from '../publish-infra/npm/auth-identity.mts'
import { cacheBustedRead } from '../publish-infra/npm/registry.mts'
import { runPlaceholder } from '../publish-infra/npm/placeholder.mts'
import type {
  Access,
  PlaceholderResult,
} from '../publish-infra/npm/placeholder.mts'
import type { PublishingAccessRead } from '../publish-infra/npm/access-parse.mts'
import type { PublishingAccessDesired } from '../publish-infra/npm/access-plan.mts'

export interface ExecResult {
  code: number
  stderr: string
  stdout: string
}

export type RegistryJsonResult =
  | { body: unknown; status: number }
  | { unreachable: string }

/**
 * The bootstrap's complete effects surface. The six core members are the
 * §3.6 contract; the operation members are thin named wrappers over the
 * ported engine so tests can assert "runPlaceholder invoked once with the
 * expected access" without faking a PTY.
 */
export interface BootstrapSeams {
  ensureNpmIdentity(pkg: string): Promise<boolean>
  exec(cmd: string, args: string[], cwd: string): Promise<ExecResult>
  execPty(cmd: string, args: string[], cwd: string): Promise<number>
  listDir(p: string): string[]
  now(): Date
  readFile(p: string): string | undefined
  readPublishingAccess(pkg: string): Promise<PublishingAccessRead>
  registryJson(url: string): Promise<RegistryJsonResult>
  resolveKitDep(specifier: string, fromRoot: string): boolean
  runPlaceholder(config: {
    access: Access
    apply: boolean
    names: string[]
  }): Promise<PlaceholderResult[]>
  writeFile(p: string, content: string): void
  writePublishingAccess(
    pkg: string,
    desired: PublishingAccessDesired,
  ): Promise<{ ok: boolean; read: PublishingAccessRead }>
}

async function execCapture(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  return await new Promise(resolve => {
    const childPromise = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // The enriched promise rejects on non-zero exit; the exit code IS the
    // signal here, so swallow the rejection and resolve from the events.
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (e: Error) => {
      resolve({
        code: 127,
        stderr: stderr || `spawn ${cmd} failed: ${e.message}`,
        stdout,
      })
    })
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr, stdout })
    })
  })
}

/**
 * The real seams. The publishing-access lanes open the sanctioned browser
 * session lazily (dynamic import) so a plan-mode run that never reaches them
 * loads no playwright at all.
 */
export function resolveSeams(): BootstrapSeams {
  return {
    ensureNpmIdentity: pkg => ensureNpmIdentity(pkg),
    exec: execCapture,
    execPty: async (cmd, args, cwd) => {
      // The npm-web-auth router self-wraps in a PTY when it needs one, so
      // an inherit-stdio spawn is the right lane: its APPROVE HERE
      // passthrough reaches the operator directly.
      const child = spawn(cmd, args, { cwd, stdio: 'inherit' })
      void child.catch(() => undefined)
      return await new Promise<number>((resolve, reject) => {
        child.process.on('error', reject)
        child.process.on('exit', code => resolve(code ?? 0))
      })
    },
    listDir: p => {
      try {
        return fs.readdirSync(p)
      } catch {
        return []
      }
    },
    now: () => new Date(),
    readFile: p => {
      try {
        return fs.readFileSync(p, 'utf8')
      } catch {
        return undefined
      }
    },
    readPublishingAccess: async pkg => {
      const { openNpmBrowserSession } =
        await import('../publish-infra/npm/browser-session.mts')
      const { readPublishingAccessInPage } =
        await import('../publish-infra/npm/access-page.mts')
      const session = await openNpmBrowserSession({ scope: 'bootstrap' })
      try {
        return await readPublishingAccessInPage(session.page, pkg)
      } finally {
        await session.close()
      }
    },
    registryJson: async url => {
      const read = cacheBustedRead(url, 'application/vnd.npm.install-v1+json')
      try {
        const res = await httpRequest(read.url, {
          headers: read.headers,
          timeout: 15_000,
        })
        let body: unknown
        try {
          body = JSON.parse(res.body.toString('utf8'))
        } catch {
          body = undefined
        }
        return { body, status: res.status }
      } catch (e) {
        return { unreachable: errorMessage(e) }
      }
    },
    resolveKitDep: (specifier, fromRoot) => {
      try {
        createRequire(path.join(fromRoot, 'package.json')).resolve(specifier)
        return true
      } catch {
        return false
      }
    },
    runPlaceholder: config =>
      runPlaceholder({
        access: config.access,
        apply: config.apply,
        names: config.names,
      }),
    writeFile: (p, content) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, content)
    },
    writePublishingAccess: async (pkg, desired) => {
      const { openNpmBrowserSession } =
        await import('../publish-infra/npm/browser-session.mts')
      const { drivePublishingAccess } =
        await import('../publish-infra/npm/access-page.mts')
      const session = await openNpmBrowserSession({ scope: 'bootstrap' })
      try {
        return await drivePublishingAccess(session.page, pkg, desired)
      } finally {
        await session.close()
      }
    },
  }
}

/**
 * Where the bootstrap's own repo root is — re-exported so steps never call
 * `process.cwd()`.
 */
export { REPO_ROOT }
