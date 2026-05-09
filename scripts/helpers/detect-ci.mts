#!/usr/bin/env pnpm dlx tsx
/**
 * Detect CI/CD system from project config files.
 *
 * Usage: pnpm dlx tsx scripts/helpers/detect-ci.ts [--dir <path>]
 *
 * Outputs JSON: { ci: [{ system, configFile }], scm: { provider, remote? } }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

interface CISystem {
  system: string
  configFile: string
}

interface SCMInfo {
  provider: string
  remote?: string
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

function parseArgs(): { dir: string } {
  const args = process.argv.slice(2)
  let dir = '.'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i]
    }
  }
  return { dir: path.resolve(dir) }
}

function detectCI(dir: string): CISystem[] {
  const results: CISystem[] = []

  for (const pattern of CI_PATTERNS) {
    const fullPath = path.join(dir, pattern.path)
    if (fs.existsSync(fullPath)) {
      if (pattern.system === 'github-actions') {
        // Check for actual workflow files
        try {
          const files = fs.readdirSync(fullPath)
          const workflows = files.filter(
            f => f.endsWith('.yml') || f.endsWith('.yaml'),
          )
          for (const wf of workflows) {
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

function detectSCM(dir: string): SCMInfo {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim()

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
  } catch {
    // Not a git repo or no remote
    const isGit = fs.existsSync(path.join(dir, '.git'))
    if (isGit) {
      return { provider: 'git-local' }
    }
    return { provider: 'none' }
  }
}

function main(): void {
  try {
    const { dir } = parseArgs()
    const ci = detectCI(dir)
    const scm = detectSCM(dir)
    process.stdout.write(JSON.stringify({ ci, scm }, null, 2) + '\n')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(JSON.stringify({ error: message }) + '\n')
    process.exit(1)
  }
}

main()
