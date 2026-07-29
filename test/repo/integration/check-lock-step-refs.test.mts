// Specs for scripts/repo/check-lock-step-refs.mts.
//
// The script is the CI-gate side of the Lock-step convention. It walks
// the scan dirs declared in .config/lock-step-refs.json, greps every
// canonical `Lock-step (with|from) <Lang>: <path>` comment, and fails
// when the path doesn't resolve. Companion edit-time hook is
// .claude/hooks/fleet/lock-step-ref-nudge/.
//
// Test strategy: build a tmpdir repo with a known set of source files +
// a config + (optionally) the target files the refs claim. Spawn the
// script from that cwd and inspect exit code + stderr/stdout. Each test
// owns its own tmpdir to avoid cross-pollution.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { isObject } from '@socketsecurity/lib-stable/objects/predicates'

import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'

const SCRIPT_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'repo',
  'check-lock-step-refs.mts',
)

interface RepoSpec {
  readonly configContent?: string | undefined
  readonly files: Readonly<Record<string, string>>
}

function makeRepo(spec: RepoSpec): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'clsr-'))
  if (spec.configContent !== undefined) {
    mkdirSync(path.join(root, '.config'), { recursive: true })
    writeFileSync(
      path.join(root, '.config', 'lock-step-refs.json'),
      spec.configContent,
    )
  }
  for (const [rel, content] of Object.entries(spec.files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function runGate(
  cwd: string,
  args: readonly string[] = [],
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [SCRIPT_PATH, ...args], {
    cwd,
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.status ?? -1,
  }
}

it('exits 0 cleanly when .config/lock-step-refs.json is absent', () => {
  const repo = makeRepo({ files: {} })
  const { exitCode, stdout } = runGate(repo)
  expect(exitCode).toBe(0)
  expect(stdout).toMatch(/opt-in gate disabled/)
  safeDeleteSync(repo)
})

it('exits 2 when config is malformed JSON', () => {
  const repo = makeRepo({
    configContent: '{ not valid json',
    files: {},
  })
  const { exitCode, stderr } = runGate(repo)
  expect(exitCode).toBe(2)
  expect(stderr).toMatch(/not valid JSON/)
  safeDeleteSync(repo)
})

it('exits 2 when config is missing "roots"', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({ scan: [], extensions: [] }),
    files: {},
  })
  const { exitCode, stderr } = runGate(repo)
  expect(exitCode).toBe(2)
  expect(stderr).toMatch(/missing required "roots"/)
  safeDeleteSync(repo)
})

it('exits 0 when all refs resolve', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'crates/parser/src/class.rs': '',
      'src/parser/class.go':
        '//! Lock-step from Rust: parser/src/class.rs\npackage parser',
    },
  })
  const { exitCode, stdout } = runGate(repo)
  expect(exitCode).toBe(0)
  expect(stdout).toMatch(/scanned \d+ files — clean/)
  safeDeleteSync(repo)
})

it('exits 1 when a ref points at a missing path', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/parser/class.go':
        '//! Lock-step from Rust: parser-stmt/src/class.rs\npackage parser',
    },
  })
  const { exitCode, stderr } = runGate(repo)
  expect(exitCode).toBe(1)
  expect(stderr).toMatch(/stale reference/)
  expect(stderr).toMatch(/parser-stmt\/src\/class\.rs/)
  safeDeleteSync(repo)
})

it('exits 1 when <Lang> is not in roots config', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/parser/class.go':
        '//! Lock-step from Bash: scripts/run.sh\npackage parser',
    },
  })
  const { exitCode, stderr } = runGate(repo)
  expect(exitCode).toBe(1)
  expect(stderr).toMatch(/unknown <Lang>/)
  safeDeleteSync(repo)
})

it('does NOT match prose "Lock-step with Go: JSON parser"', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Go: ['src'] },
      scan: ['src'],
      extensions: ['.rs'],
    }),
    files: {
      'src/foo.rs':
        '// Lock-step with Go: JSON parser semantics are subtle.\nfn x() {}',
    },
  })
  const { exitCode, stdout } = runGate(repo)
  expect(exitCode).toBe(0)
  expect(stdout).toMatch(/clean/)
  safeDeleteSync(repo)
})

it('accepts inline ref with line range', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Go: ['src'] },
      scan: ['src'],
      extensions: ['.rs'],
    }),
    files: {
      'src/parser.go': '',
      'src/foo.rs': '// Lock-step with Go: src/parser.go:6450-6457\nfn x() {}',
    },
  })
  const { exitCode } = runGate(repo)
  expect(exitCode).toBe(0)
  safeDeleteSync(repo)
})

it('--json emits machine-readable findings', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/foo.go':
        '//! Lock-step from Rust: parser-stmt/src/x.rs\npackage foo',
    },
  })
  const { exitCode, stdout } = runGate(repo, ['--json'])
  expect(exitCode).toBe(1)
  const parsed: unknown = JSON.parse(stdout)
  expect(Array.isArray(parsed)).toBeTruthy()
  expect(parsed.length).toBe(1)
  const first: unknown = parsed[0]
  expect(isObject(first)).toBeTruthy()
  expect(first['lang']).toBe('Rust')
  expect(first['reason']).toBe('path-not-found')
  safeDeleteSync(repo)
})

it('--quiet suppresses clean-run stdout', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'crates/parser/src/class.rs': '',
      'src/parser/class.go':
        '//! Lock-step from Rust: parser/src/class.rs\npackage parser',
    },
  })
  const { exitCode, stdout } = runGate(repo, ['--quiet'])
  expect(exitCode).toBe(0)
  expect(stdout).toBe('')
  safeDeleteSync(repo)
})

it('skips SKIP_DIRS (node_modules, dist, target)', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      // These should be IGNORED — stale ref inside node_modules/ shouldn't fail the gate.
      'src/node_modules/junk/file.go':
        '//! Lock-step from Rust: doesnotexist.rs\npackage x',
      'src/dist/x.go': '//! Lock-step from Rust: doesnotexist.rs\npackage x',
      'src/target/x.go': '//! Lock-step from Rust: doesnotexist.rs\npackage x',
    },
  })
  const { exitCode } = runGate(repo)
  expect(exitCode).toBe(0)
  safeDeleteSync(repo)
})

it('resolves path against repo-root before per-lang roots', () => {
  // A Rust file in ultrathink references `parser.go` — root-relative form
  // (the Go impl tree puts parser.go where it does without lang-prefix).
  // Should resolve when EITHER repo-root OR <lang>-root contains it.
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Go: ['langs/go/src'] },
      scan: ['langs/rust'],
      extensions: ['.rs'],
    }),
    files: {
      // Found via root-relative path resolution.
      'parser.go': '',
      'langs/rust/foo.rs': '// Lock-step with Go: parser.go:42\nfn x() {}',
    },
  })
  const { exitCode } = runGate(repo)
  expect(exitCode).toBe(0)
  safeDeleteSync(repo)
})

it('reports findings grouped by file', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/a.go':
        '//! Lock-step from Rust: stale-a.rs\n// Lock-step with Rust: stale-b.rs\npackage a',
      'src/b.go': '//! Lock-step from Rust: stale-c.rs\npackage b',
    },
  })
  const { exitCode, stderr } = runGate(repo)
  expect(exitCode).toBe(1)
  // Three findings across two files.
  expect(stderr).toMatch(/3 stale reference/)
  // File-grouped: each file appears once in the output even with multiple hits.
  expect(stderr).toMatch(/src\/a\.go/)
  expect(stderr).toMatch(/src\/b\.go/)
  safeDeleteSync(repo)
})
