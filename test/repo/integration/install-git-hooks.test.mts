// Specs for scripts/repo/install-git-hooks.mts.
//
// The installer is invoked from `prepare` at `pnpm install` time. Its
// job: set `core.hooksPath = .git-hooks` in the local git config when
// run inside a git checkout that has a `.git-hooks/` dir. Replaces
// husky's auto-install side effect with a 60-LOC dependency-free
// script.
//
// Each test spawns the installer in a tmpdir with a controlled
// .git/ + .git-hooks/ layout, then inspects the resulting
// core.hooksPath value via `git config`. Idempotency is verified by
// running the installer twice and confirming the second run is silent.
//
// The installer anchors REPO_ROOT on its own `import.meta.url` (not
// `process.cwd()`), so each test must COPY install-git-hooks.mts into
// `<tmpdir>/scripts/repo/install-git-hooks.mts` before spawning it. Running
// the original script in the wheelhouse/fleet repo would still
// resolve REPO_ROOT to the real repo and write to the real git config
// instead of the tmpdir, which is what we want to verify.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import { isolateGitEnv } from '../../../.git-hooks/_shared/isolate-git-env.mts'
import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'

// The fleet vitest setup already pins the git env, and this suite spawns `git`
// against throwaway tmpdirs, so pin it here too: an inherited GIT_DIR would
// send every fixture's config write at the live checkout.
isolateGitEnv({ pinConfigToNull: true })

const SOURCE_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'repo',
  'install-git-hooks.mts',
)

interface TmpRepo {
  /**
   * Absolute path to the tmpdir; serves as the repo root the installer sees.
   */
  readonly dir: string
  /**
   * Copy of install-git-hooks.mts under <dir>/scripts/ — what each test spawns.
   */
  readonly installerPath: string
  /**
   * Where the installer expects to find / will write `core.hooksPath` -> here.
   */
  readonly hooksDir: string
  readonly cleanup: () => void
}

function makeTmpRepo(): TmpRepo {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'install-git-hooks-test-'))
  // Mirror the real on-disk layout:
  // <repo-root>/scripts/repo/install-git-hooks.mts. The installer derives
  // REPO_ROOT as `path.dirname(import.meta.url)/../..`, so placing the copy
  // under `<dir>/scripts/repo/` makes REPO_ROOT === dir.
  const scriptsDir = path.join(dir, 'scripts', 'repo')
  mkdirSync(scriptsDir, { recursive: true })
  const installerPath = path.join(scriptsDir, 'install-git-hooks.mts')
  copyFileSync(SOURCE_SCRIPT, installerPath)
  // The installer's entrypoint guard imports
  // scripts/fleet/_shared/is-main-module.mts relative to itself, so the
  // fixture mirrors that file too.
  const fleetSharedDir = path.join(dir, 'scripts', 'fleet', '_shared')
  mkdirSync(fleetSharedDir, { recursive: true })
  copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'fleet', '_shared', 'is-main-module.mts'),
    path.join(fleetSharedDir, 'is-main-module.mts'),
  )
  // The installer imports `@socketsecurity/lib-stable`, and Node resolves a
  // bare specifier by walking up from the importing file. The copy sits in a
  // tmpdir with no dependency tree, so link this repo's `node_modules` in as
  // the fixture's own. `junction` is the Windows-safe directory link type and
  // is ignored on other platforms.
  symlinkSync(
    path.join(REPO_ROOT, 'node_modules'),
    path.join(dir, 'node_modules'),
    'junction',
  )
  // Construct once; tests reference `repo.hooksDir` everywhere they need it.
  const hooksDir = path.join(dir, '.git-hooks')
  return {
    dir,
    installerPath,
    hooksDir,
    cleanup: () => {
      safeDeleteSync(dir)
    },
  }
}

// Initialize an empty git repo at dir. Uses `git init` so the .git
// directory has the same shape git itself expects (objects/, refs/,
// HEAD, …). Inheriting the user's git config could pollute the local
// `core.hooksPath` we're trying to inspect, so the test config sets a
// minimal identity and disables `core.hooksPath` inheritance via
// --local writes only.
function gitInit(dir: string): void {
  const r = spawnSync('git', ['init', '--quiet', dir], {})
  if (r.status !== 0) {
    throw new Error(
      `Could not create the git fixture.\n` +
        `  Where: ${dir}\n` +
        `  Saw: \`git init\` exited ${r.status}: ${r.stderr.trim()}\n` +
        `  Wanted: exit 0 and a .git directory.\n` +
        `  Fix: check that \`git\` is on PATH and the temp dir is writable.`,
    )
  }
}

function readLocalConfig(dir: string, key: string): string | undefined {
  const r = spawnSync('git', ['-C', dir, 'config', '--local', '--get', key], {})
  return r.status === 0 ? r.stdout.trim() : undefined
}

function runInstaller(
  installerPath: string,
  cwd: string,
): { code: number; stderr: string } {
  const r = spawnSync(process.execPath, [installerPath], {
    cwd,
  })
  return { code: r.status ?? 0, stderr: r.stderr || '' }
}

it('install-git-hooks: sets core.hooksPath when .git + .git-hooks both present', () => {
  const repo = makeTmpRepo()
  try {
    gitInit(repo.dir)
    mkdirSync(repo.hooksDir, { recursive: true })
    writeFileSync(path.join(repo.hooksDir, 'pre-commit'), '#!/bin/sh\nexit 0\n')

    const result = runInstaller(repo.installerPath, repo.dir)
    expect(result.code, `installer stderr: ${result.stderr}`).toBe(0)
    expect(readLocalConfig(repo.dir, 'core.hooksPath')).toBe('.git-hooks')
  } finally {
    repo.cleanup()
  }
})

it('install-git-hooks: idempotent — second run is a silent no-op', () => {
  const repo = makeTmpRepo()
  try {
    gitInit(repo.dir)
    mkdirSync(repo.hooksDir, { recursive: true })

    const first = runInstaller(repo.installerPath, repo.dir)
    expect(first.code).toBe(0)
    expect(readLocalConfig(repo.dir, 'core.hooksPath')).toBe('.git-hooks')

    const second = runInstaller(repo.installerPath, repo.dir)
    expect(second.code).toBe(0)
    // Still set, still pointing at .git-hooks.
    expect(readLocalConfig(repo.dir, 'core.hooksPath')).toBe('.git-hooks')
    // Second run produced no stderr (truly silent on the no-op path).
    expect(second.stderr.trim()).toBe('')
  } finally {
    repo.cleanup()
  }
})

it('install-git-hooks: skips when .git dir is absent (e.g. tarball install)', () => {
  const repo = makeTmpRepo()
  try {
    // No `git init` — just create .git-hooks/ alone.
    mkdirSync(repo.hooksDir, { recursive: true })

    const result = runInstaller(repo.installerPath, repo.dir)
    expect(result.code).toBe(0)
    // No config to inspect — the dir isn't a git repo.
    expect(readLocalConfig(repo.dir, 'core.hooksPath')).toBe(undefined)
  } finally {
    repo.cleanup()
  }
})

it('install-git-hooks: skips when .git-hooks dir is absent (pre-cascade state)', () => {
  const repo = makeTmpRepo()
  try {
    gitInit(repo.dir)
    // No .git-hooks dir.

    const result = runInstaller(repo.installerPath, repo.dir)
    expect(result.code).toBe(0)
    // Installer bowed out before writing config.
    expect(readLocalConfig(repo.dir, 'core.hooksPath')).toBe(undefined)
  } finally {
    repo.cleanup()
  }
})
