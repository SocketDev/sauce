#!/usr/bin/env pnpm dlx tsx
/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * Detect CI/CD system from project config files.
 *
 * Usage: pnpm dlx tsx scripts/helpers/detect-ci.ts [--dir <path>]
 *
 * Outputs JSON: { ci: [{ system, configFile }], scm: { provider, remote? } }
 */

import { existsSync, readdirSync } from 'node:fs'
import * as path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

interface CISystem {
  system: string
  configFile: string
}

interface SCMInfo {
  provider: string
  remote?: string | undefined
}

const CI_PATTERNS: Array<{ system: string; path: string }> = [
  { system: 'github-actions', path: '.github/workflows' },
  { system: 'gitlab-ci', path: '.gitlab-ci.yml' },
  { system: 'bitbucket-pipelines', path: 'bitbucket-pipelines.yml' },
  { system: 'jenkins', path: 'Jenkinsfile' },
  { system: 'circleci', path: '.circleci/config.yml' },
  { system: 'travis', path: '.travis.yml' },
  { system: 'azure-pipelines', path: 'azure-pipelines.yml' },
]

export function detectCI(dir: string): CISystem[] {
  const results: CISystem[] = []

  for (let i = 0, { length } = CI_PATTERNS; i < length; i += 1) {
    const pattern = CI_PATTERNS[i]!
    const fullPath = path.join(dir, pattern.path)
    if (existsSync(fullPath)) {
      if (pattern.system === 'github-actions') {
        // Check for actual workflow files
        try {
          const files = readdirSync(fullPath)
          const workflows = files.filter(
            f => f.endsWith('.yml') || f.endsWith('.yaml'),
          )
          for (let i = 0, { length } = workflows; i < length; i += 1) {
            const wf = workflows[i]!
            results.push({
              system: 'github-actions',
              configFile: path.join(pattern.path, wf),
            })
          }
        } catch {
          // directory exists but can't be read
        }
      } else {
        results.push({
          system: pattern.system,
          configFile: pattern.path,
        })
      }
    }
  }

  return results
}

export function detectSCM(dir: string): SCMInfo {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: dir,
  })
  if (result.status !== 0) {
    // Not a git repo or no remote
    const isGit = existsSync(path.join(dir, '.git'))
    if (isGit) {
      return { provider: 'git-local' }
    }
    return { provider: 'none' }
  }

  const remote = result.stdout.trim()
  if (remote.includes('github.com')) {
    return { provider: 'github', remote }
  }
  if (remote.includes('gitlab.com') || remote.includes('gitlab')) {
    return { provider: 'gitlab', remote }
  }
  if (remote.includes('bitbucket.org')) {
    return { provider: 'bitbucket', remote }
  }
  return { provider: 'other', remote }
}

export function parseArgs(): { dir: string } {
  const args = process.argv.slice(2)
  let dir = '.'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i]!
    }
  }
  return { dir: path.resolve(dir) }
}

function main(): void {
  try {
    const { dir } = parseArgs()
    const ci = detectCI(dir)
    const scm = detectSCM(dir)
    process.stdout.write(JSON.stringify({ ci, scm }, null, 2) + '\n')
  } catch (err: unknown) {
    process.stderr.write(JSON.stringify({ error: errorMessage(err) }) + '\n')
    process.exit(1)
  }
}

main()
