/**
 * @file Full in-process bootstrap runs over the installed npm-lib scenario
 *   with fully fake seams: the plan run (golden, exit 0), the
 *   staged-placeholder block (golden, exit 3, gate lines pass the shape
 *   assertions), the apply-without-reserve block (golden, exit 3, ZERO
 *   publish effects), the DAG violation (exit 4), the status run (golden,
 *   exit 0), stdout purity in --json mode, and plan-mode zero-writes. Every
 *   emitted document and every committed golden passes validateRunJson.
 *   Plus the spawn smokes: --help → 0, unknown step → 2, --apply --dry-run
 *   → 2 (bootstrap) and --help → 0 (installer).
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { runBootstrap } from '../../../../release-kit/payload/scripts/socket-release/bootstrap.mts'
import { validateRunJson } from '../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import type { RunJson } from '../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import {
  ROOT,
  buildScenario,
  normalizeRunDoc,
  runFixture,
} from './scenarios.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(HERE, '../../../..')

interface CapturedRun {
  doc: RunJson
  exitCode: number
  humanLines: string[]
  stdout: string
}

async function capture(config: {
  argv: string[]
  scenario?: Parameters<typeof buildScenario>[0]
}): Promise<CapturedRun> {
  const scenario = buildScenario(config.scenario)
  // Every run gets a real temp dir (receipts persist there under --apply;
  // plan mode must leave it untouched); the fake file map shadows reads.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-bootstrap-'))
  const realRead = scenario.seams.readFile.bind(scenario.seams)
  scenario.seams.readFile = p =>
    realRead(p.replace(repoRoot, ROOT)) ?? realRead(p)
  let stdout = ''
  const humanLines: string[] = []
  const exitCode = await runBootstrap({
    argv: config.argv,
    log: line => humanLines.push(line),
    out: text => {
      stdout += text
    },
    repoRoot,
    seams: scenario.seams,
  })
  const doc = JSON.parse(stdout || 'null') as RunJson
  if (doc && typeof doc === 'object' && doc.repo) {
    // The temp dir is run-unique; goldens pin the canonical scenario root.
    doc.repo.root = ROOT
  }
  return { doc, exitCode, humanLines, stdout }
}

function normalizeForGolden(doc: RunJson): unknown {
  return normalizeRunDoc(doc)
}

describe('bootstrap integration (fake seams)', () => {
  it('plan run matches run-plan.golden.json and exits 0', async () => {
    const run = await capture({ argv: ['--json'] })
    expect(run.exitCode).toBe(0)
    expect(validateRunJson(run.doc)).toEqual([])
    expect(normalizeForGolden(run.doc)).toEqual(
      JSON.parse(runFixture('run/run-plan.golden.json')),
    )
  })

  it('two consecutive plan runs emit identical documents', async () => {
    const first = await capture({ argv: ['--json'] })
    const second = await capture({ argv: ['--json'] })
    expect(normalizeRunDoc(first.doc)).toEqual(normalizeRunDoc(second.doc))
  })

  it('--json stdout carries EXACTLY one JSON document (human logs on stderr lane)', async () => {
    const run = await capture({ argv: ['--json'] })
    expect(() => JSON.parse(run.stdout)).not.toThrow()
    expect(run.humanLines.length).toBeGreaterThan(0)
    expect(run.stdout.trimEnd().startsWith('{')).toBe(true)
    expect(run.stdout.trimEnd().endsWith('}')).toBe(true)
  })

  it('staged placeholder blocks (exit 3) matching run-blocked.golden.json with shaped gate lines', async () => {
    const run = await capture({
      argv: ['--apply', '--json'],
      scenario: { stage: 'staged' },
    })
    expect(run.exitCode).toBe(3)
    expect(validateRunJson(run.doc)).toEqual([])
    const blocked = run.doc.steps.find(s => s.status === 'blocked')
    expect(blocked?.step).toBe('placeholder')
    // SANCTIONED SHAPE EXCEPTION: gate line prefixes are the fleet contract.
    const lines = blocked!.gate!.lines
    expect(lines[0]).toMatch(/^🖐 {2}HUMAN GATE — placeholder promote \[1\/1\]$/)
    expect(lines.some(l => l.startsWith('  A) You: '))).toBe(true)
    expect(lines.some(l => l.startsWith('  B) Me: '))).toBe(true)
    expect(lines.at(-1)!.startsWith('  Then: ')).toBe(true)
    expect(normalizeForGolden(run.doc)).toEqual(
      JSON.parse(runFixture('run/run-blocked.golden.json')),
    )
  })

  it('apply without --reserve blocks on the reserve gate (exit 3) with ZERO publish effects', async () => {
    const scenario = buildScenario()
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-bootstrap-'))
    const realRead = scenario.seams.readFile.bind(scenario.seams)
    scenario.seams.readFile = p =>
      realRead(p.replace(repoRoot, ROOT)) ?? realRead(p)
    let stdout = ''
    const exitCode = await runBootstrap({
      argv: ['--apply', '--json'],
      log: () => {},
      out: t => {
        stdout += t
      },
      repoRoot,
      seams: scenario.seams,
    })
    const doc = JSON.parse(stdout) as RunJson
    expect(exitCode).toBe(3)
    expect(validateRunJson(doc)).toEqual([])
    expect(scenario.placeholderCalls).toEqual([])
    const blocked = doc.steps.find(s => s.status === 'blocked')
    expect(blocked?.gate?.name).toBe('reserve name')
    const normalized = normalizeForGolden({
      ...doc,
      repo: { ...doc.repo, root: ROOT },
    })
    expect(normalized).toEqual(
      JSON.parse(runFixture('run/run-reserve-gate.golden.json')),
    )
  })

  it('a DAG violation exits 4 naming the missing steps and the exact command', async () => {
    const run = await capture({ argv: ['trusted-publisher', '--json'] })
    expect(run.exitCode).toBe(4)
    const text = run.humanLines.join('\n')
    expect(text).toContain('placeholder, github-env, staged-config')
    expect(text).toContain(
      'node scripts/socket-release/bootstrap.mts placeholder github-env staged-config --apply',
    )
  })

  it('--status prints the eight-step table from receipts only (exit 0) matching its golden', async () => {
    const run = await capture({ argv: ['--status', '--json'] })
    expect(run.exitCode).toBe(0)
    expect(validateRunJson(run.doc)).toEqual([])
    expect(run.humanLines.filter(l => l.includes('pending'))).toHaveLength(8)
    expect(normalizeForGolden(run.doc)).toEqual(
      JSON.parse(runFixture('run/run-status.golden.json')),
    )
  })

  it('plan mode performs zero writes — no state file, no seam mutations', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-plan-'))
    const scenario = buildScenario()
    const realRead = scenario.seams.readFile.bind(scenario.seams)
    scenario.seams.readFile = p =>
      realRead(p.replace(repoRoot, ROOT)) ?? realRead(p)
    const exitCode = await runBootstrap({
      argv: [],
      log: () => {},
      out: () => {},
      repoRoot,
      seams: scenario.seams,
    })
    expect(exitCode).toBe(0)
    expect(
      fs.existsSync(
        path.join(repoRoot, '.cache/socket-release/bootstrap-state.json'),
      ),
    ).toBe(false)
    expect(scenario.placeholderCalls).toEqual([])
    expect(scenario.calls.filter(c => c.kind === 'execPty')).toEqual([])
  })

  it('every committed run golden passes validateRunJson', () => {
    for (const name of [
      'run-plan',
      'run-blocked',
      'run-reserve-gate',
      'run-status',
    ]) {
      const doc = JSON.parse(runFixture(`run/${name}.golden.json`))
      expect(validateRunJson(doc), name).toEqual([])
    }
  })
})

describe('CLI spawn smokes', () => {
  const BOOTSTRAP = path.join(
    REPO_ROOT,
    'release-kit/payload/scripts/socket-release/bootstrap.mts',
  )
  const INSTALL = path.join(REPO_ROOT, 'release-kit/install.mts')

  it('bootstrap --help exits 0', () => {
    const r = spawnSync(process.execPath, [BOOTSTRAP, '--help'], {
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
  })

  it('an unknown step exits 2', () => {
    const r = spawnSync(process.execPath, [BOOTSTRAP, 'deploy', '--json'], {
      encoding: 'utf8',
    })
    expect(r.status).toBe(2)
  })

  it('--apply --dry-run conflict exits 2', () => {
    const r = spawnSync(process.execPath, [BOOTSTRAP, '--apply', '--dry-run'], {
      encoding: 'utf8',
    })
    expect(r.status).toBe(2)
  })

  it('install --help exits 0', () => {
    const r = spawnSync(process.execPath, [INSTALL, '--help'], {
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--channels')
  })
})
