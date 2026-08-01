/**
 * @file Tap-repo effects behind `BrewSeams`: read the current formula off
 *   the tap via the GitHub contents API, commit the bumped formula with a
 *   GitHub-signed API commit (no GPG) DIRECT to the tap's default branch —
 *   never a PR (the version-bump-PR shape is guard-blocked fleet-wide) —
 *   and re-read + parse the committed bytes so success is the registry's
 *   answer, never the click. Every function takes the seams so tests drive
 *   fakes; `resolveBrewSeams()` returns the real `gh`/token-backed
 *   implementations.
 */

import process from 'node:process'

import { commitViaGithubApi } from '../../lib/commit-via-github-api.mts'
import { runCapture } from '../shared.mts'
import { parseFormula } from './formula.mts'
import type { ParsedFormula } from './formula.mts'

export interface BrewReleaseView {
  assets: string[]
  exists: boolean
  isDraft: boolean
}

export interface BrewSeams {
  commitFile(config: {
    content: string
    message: string
    path: string
    repo: string
  }): Promise<void>
  downloadChecksums(tag: string, repo: string): Promise<string | undefined>
  ghApiJson(path: string): Promise<{ body: unknown; code: number }>
  ghReleaseView(tag: string, repo: string): Promise<BrewReleaseView>
  readTapFile(
    repo: string,
    path: string,
  ): Promise<{ content: string; sha: string } | undefined>
}

/**
 * Read + parse the tap's current formula. 404 → undefined (create);
 * unparseable content still returns the raw bytes (the planner treats it as
 * replace-whole-file).
 */
export async function readTapFormula(
  seams: BrewSeams,
  repo: string,
  path: string,
): Promise<{ parsed: ParsedFormula | undefined; raw: string } | undefined> {
  const file = await seams.readTapFile(repo, path)
  if (file === undefined) {
    return undefined
  }
  return { parsed: parseFormula(file.content), raw: file.content }
}

/**
 * Commit the bumped formula direct to the tap default branch, then re-read:
 * the committed bytes must equal what was sent, or the caller reports
 * saved-state unproven.
 */
export async function commitFormula(
  seams: BrewSeams,
  config: {
    content: string
    formulaName: string
    path: string
    repo: string
    version: string
  },
): Promise<{ verified: boolean }> {
  const cfg = { __proto__: null, ...config } as typeof config
  await seams.commitFile({
    content: cfg.content,
    message: `chore: bump ${cfg.formulaName} to ${cfg.version}`,
    path: cfg.path,
    repo: cfg.repo,
  })
  const reread = await seams.readTapFile(cfg.repo, cfg.path)
  return { verified: reread !== undefined && reread.content === cfg.content }
}

/**
 * The real seams: `gh api` for reads (ambient gh auth), the GitHub-signed
 * API commit for the write (GH_TOKEN in CI — minted by the co-located
 * socket-release-app-token composite — or ambient `gh auth token` locally).
 */
export function resolveBrewSeams(cwd: string): BrewSeams {
  async function ghJson(
    apiPath: string,
  ): Promise<{ body: unknown; code: number }> {
    const { code, stdout } = await runCapture('gh', ['api', apiPath], cwd)
    let body: unknown
    try {
      body = JSON.parse(stdout)
    } catch {
      body = undefined
    }
    return { body, code }
  }
  async function token(): Promise<string> {
    const envToken = process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']
    if (envToken) {
      return envToken
    }
    const { code, stdout } = await runCapture('gh', ['auth', 'token'], cwd)
    if (code !== 0 || !stdout.trim()) {
      throw new Error(
        'no GitHub token: set GH_TOKEN (CI mints one via the socket-release-app-token composite) or run `gh auth login`.',
      )
    }
    return stdout.trim()
  }
  return {
    commitFile: async cfg => {
      const ghToken = await token()
      const [repoRead, refRead] = await Promise.all([
        ghJson(`repos/${cfg.repo}`),
        ghJson(`repos/${cfg.repo}/git/ref/heads/main`).then(async r =>
          r.code === 0
            ? r
            : await ghJson(`repos/${cfg.repo}/git/ref/heads/master`),
        ),
      ])
      const defaultBranch =
        (repoRead.body as { default_branch?: string | undefined } | undefined)
          ?.default_branch ?? 'main'
      const ref =
        refRead.code === 0
          ? refRead
          : await ghJson(`repos/${cfg.repo}/git/ref/heads/${defaultBranch}`)
      const parentSha = (
        ref.body as
          | { object?: { sha?: string | undefined } | undefined }
          | undefined
      )?.object?.sha
      if (!parentSha) {
        throw new Error(`could not resolve ${cfg.repo}'s default branch head.`)
      }
      const commitRead = await ghJson(
        `repos/${cfg.repo}/git/commits/${parentSha}`,
      )
      const baseTreeSha = (
        commitRead.body as
          | { tree?: { sha?: string | undefined } | undefined }
          | undefined
      )?.tree?.sha
      if (!baseTreeSha) {
        throw new Error(`could not resolve ${cfg.repo}'s HEAD tree.`)
      }
      await commitViaGithubApi({
        baseTreeSha,
        branch: defaultBranch,
        files: [{ content: cfg.content, path: cfg.path }],
        message: cfg.message,
        parentSha,
        repo: cfg.repo,
        token: ghToken,
      })
    },
    downloadChecksums: async (tag, repo) => {
      const { code, stdout } = await runCapture(
        'gh',
        [
          'release',
          'download',
          tag,
          '--repo',
          repo,
          '--pattern',
          'checksums.txt',
          '--output',
          '-',
        ],
        cwd,
      )
      return code === 0 ? stdout : undefined
    },
    ghApiJson: ghJson,
    ghReleaseView: async (tag, repo) => {
      const { code, stdout } = await runCapture(
        'gh',
        ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets'],
        cwd,
      )
      if (code !== 0) {
        return { assets: [], exists: false, isDraft: false }
      }
      try {
        const parsed = JSON.parse(stdout) as {
          assets?: Array<{ name?: string | undefined }> | undefined
          isDraft?: boolean | undefined
        }
        return {
          assets: (parsed.assets ?? [])
            .map(a => a.name)
            .filter((n): n is string => typeof n === 'string'),
          exists: true,
          isDraft: parsed.isDraft === true,
        }
      } catch {
        return { assets: [], exists: false, isDraft: false }
      }
    },
    readTapFile: async (repo, filePath) => {
      const { body, code } = await ghJson(`repos/${repo}/contents/${filePath}`)
      if (code !== 0) {
        return undefined
      }
      const doc = body as
        | { content?: string | undefined; sha?: string | undefined }
        | undefined
      if (!doc?.content) {
        return undefined
      }
      return {
        content: Buffer.from(doc.content, 'base64').toString('utf8'),
        sha: doc.sha ?? '',
      }
    },
  }
}
