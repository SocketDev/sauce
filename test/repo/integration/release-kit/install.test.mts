/**
 * @file Installer integration: each example copied to a temp dir, the
 *   in-process installer run with REAL fs against it — the produced file
 *   list equals the example's expected-install.json, an immediate second
 *   --apply plans zero copies, --verify exits 0, and the config seed is
 *   write-only-if-absent. The installer never touches .github/workflows,
 *   package.json, or .gitignore (that is staged-config's job).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { runInstall } from '../../../../release-kit/install.mts'
import type { KitChannel } from '../../../../release-kit/install/manifest.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXAMPLES = path.join(HERE, '../../../../release-kit/examples')

const CASES: Array<{ channels: KitChannel[]; name: string }> = [
  { channels: ['npm', 'github-release'], name: 'npm-lib' },
  { channels: ['crates', 'github-release'], name: 'rust-crate' },
  { channels: ['npm', 'github-release', 'brew'], name: 'brew-cli' },
]

function tempCopy(example: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kit-install-${example}-`))
  fs.cpSync(path.join(EXAMPLES, example), dir, { recursive: true })
  return dir
}

describe('installer integration (real fs, temp dirs)', () => {
  for (const { channels, name } of CASES) {
    it(`${name}: --apply matches expected-install.json, second apply is empty, --verify exits 0`, () => {
      const target = tempCopy(name)
      const expected = JSON.parse(
        fs.readFileSync(
          path.join(EXAMPLES, name, 'expected-install.json'),
          'utf8',
        ),
      ) as { channels: string[]; files: string[] }

      const apply = runInstall({
        apply: true,
        channels,
        force: false,
        log: () => {},
        target,
        verify: false,
      })
      expect(apply.exitCode).toBe(0)
      const produced = apply.files
        .filter(f => f.action === 'copy')
        .map(f => `scripts/socket-release/${f.path}`)
        .toSorted()
      expect(produced).toEqual(expected.files)
      expect(apply.channels).toEqual(expected.channels)
      // Every produced file actually landed on disk.
      for (const rel of produced) {
        expect(fs.existsSync(path.join(target, rel)), rel).toBe(true)
      }

      // The installer never touches the workflow/manifest surfaces.
      expect(fs.existsSync(path.join(target, '.github/workflows'))).toBe(false)

      // The config seed exists (write-only-if-absent).
      expect(
        fs.existsSync(path.join(target, '.config/socket-release.json')),
      ).toBe(true)

      const second = runInstall({
        apply: true,
        channels,
        force: false,
        log: () => {},
        target,
        verify: false,
      })
      expect(second.exitCode).toBe(0)
      expect(second.files.filter(f => f.action === 'copy')).toEqual([])

      const verify = runInstall({
        apply: false,
        channels,
        force: false,
        log: () => {},
        target,
        verify: true,
      })
      expect(verify.exitCode).toBe(0)
    })
  }

  it('a hand-edited installed file is a per-file conflict refusal; --force restores', () => {
    const target = tempCopy('npm-lib')
    runInstall({
      apply: true,
      channels: ['npm'],
      force: false,
      log: () => {},
      target,
      verify: false,
    })
    const victim = path.join(target, 'scripts/socket-release/bootstrap.mts')
    fs.appendFileSync(victim, '// hand edit\n')
    const conflicted = runInstall({
      apply: true,
      channels: ['npm'],
      force: false,
      log: () => {},
      target,
      verify: false,
    })
    expect(conflicted.exitCode).toBe(1)
    expect(conflicted.files.some(f => f.action === 'conflict')).toBe(true)
    const forced = runInstall({
      apply: true,
      channels: ['npm'],
      force: true,
      log: () => {},
      target,
      verify: false,
    })
    expect(forced.exitCode).toBe(0)
    const verify = runInstall({
      apply: false,
      channels: ['npm'],
      force: false,
      log: () => {},
      target,
      verify: true,
    })
    expect(verify.exitCode).toBe(0)
  })

  it('the config seed never overwrites an existing config', () => {
    const target = tempCopy('npm-lib')
    const configPath = path.join(target, '.config/socket-release.json')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, '{"schemaVersion":1,"channels":["npm"]}\n')
    runInstall({
      apply: true,
      channels: ['npm'],
      force: false,
      log: () => {},
      target,
      verify: false,
    })
    expect(fs.readFileSync(configPath, 'utf8')).toBe(
      '{"schemaVersion":1,"channels":["npm"]}\n',
    )
  })
})
