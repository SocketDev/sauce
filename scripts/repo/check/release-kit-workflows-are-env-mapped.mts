/*
 * @file `check --all` gate: the kit's workflow templates hold the fleet
 *   zizmor posture. Per templates/workflows/*.yml: (1) no `${{` inside any
 *   `run:` scalar — inputs reach shell through env-mapped variables, never
 *   expression interpolation, the classic injection shape; (2) every
 *   third-party `uses:` is SHA-pinned (40 hex) with a trailing
 *   `# <tag> (YYYY-MM-DD)` comment so the pin is auditable; (3) top-level
 *   `permissions:` and `concurrency:` blocks are present. Pure line-scan
 *   helpers exported for tests.
 */

import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { PAYLOAD_ROOT } from '../../../release-kit/install/effects.mts'

const logger = getDefaultLogger()

export interface WorkflowViolation {
  detail: string
  file: string
  line: number
}

/**
 * Every `${{` occurrence inside a `run:` scalar (single-line or block).
 * Pure — exported for tests.
 */
export function findRunExpressionViolations(
  file: string,
  text: string,
): WorkflowViolation[] {
  const violations: WorkflowViolation[] = []
  const lines = text.split('\n')
  let inRunBlock = false
  let runIndent = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // A run: key with its leading indent (group 1) and inline value
    // (group 2) — a block indicator or a single-line scalar.
    const runStart = /^(\s*)run:\s*(.*)$/.exec(line)
    if (runStart) {
      const rest = runStart[2] ?? ''
      if (rest === '>' || rest === '>-' || rest === '|' || rest === '|-') {
        inRunBlock = true
        runIndent = runStart[1]!.length
        continue
      }
      if (rest.includes('${{')) {
        violations.push({
          detail: 'a `${{ }}` expression inside a run: scalar',
          file,
          line: i + 1,
        })
      }
      inRunBlock = false
      continue
    }
    if (inRunBlock) {
      const indent = /^(\s*)/.exec(line)![1]!.length
      if (line.trim() !== '' && indent <= runIndent) {
        inRunBlock = false
      } else if (line.includes('${{')) {
        violations.push({
          detail: 'a `${{ }}` expression inside a run: block',
          file,
          line: i + 1,
        })
      }
    }
  }
  return violations
}

const PINNED_USES =
  /^\s*(?:-\s+)?uses:\s+\S+@[0-9a-f]{40}\s+#\s+\S+\s+\(\d{4}-\d{2}-\d{2}\)\s*$/

/**
 * Every `uses:` line that is not a lawfully SHA-pinned, date-commented
 * reference. Local composite actions (`./…`) are exempt — there is nothing
 * to pin. Pure — exported for tests.
 */
export function findUsesPinViolations(
  file: string,
  text: string,
): WorkflowViolation[] {
  const violations: WorkflowViolation[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!/^\s*(?:-\s+)?uses:\s+/.test(line)) {
      continue
    }
    if (/^\s*(?:-\s+)?uses:\s+\.\//.test(line)) {
      continue
    }
    if (!PINNED_USES.test(line)) {
      violations.push({
        detail:
          'an unpinned or undated `uses:` — wanted `<action>@<40-hex-sha> # <tag> (YYYY-MM-DD)`',
        file,
        line: i + 1,
      })
    }
  }
  return violations
}

/**
 * Missing top-level permissions/concurrency blocks. Pure — exported for
 * tests.
 */
export function findMissingBlocks(
  file: string,
  text: string,
): WorkflowViolation[] {
  const violations: WorkflowViolation[] = []
  if (!/^permissions:/m.test(text)) {
    violations.push({
      detail: 'no top-level permissions: block',
      file,
      line: 1,
    })
  }
  if (!/^concurrency:/m.test(text)) {
    violations.push({
      detail: 'no top-level concurrency: block',
      file,
      line: 1,
    })
  }
  return violations
}

export function scanWorkflowTemplate(
  file: string,
  text: string,
): WorkflowViolation[] {
  return [
    ...findRunExpressionViolations(file, text),
    ...findUsesPinViolations(file, text),
    ...findMissingBlocks(file, text),
  ]
}

function main(): void {
  const dir = path.join(PAYLOAD_ROOT, 'templates', 'workflows')
  const files = readdirSync(dir).filter(f => f.endsWith('.yml'))
  const failures: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const text = readFileSync(path.join(dir, file), 'utf8')
    const violations = scanWorkflowTemplate(file, text)
    for (let v = 0, { length: vl } = violations; v < vl; v += 1) {
      const violation = violations[v]!
      failures.push(
        [
          'What: a kit workflow template breaks the env-mapped posture.',
          `Where: release-kit/payload/scripts/socket-release/templates/workflows/${violation.file}:${violation.line}`,
          `Saw: ${violation.detail}.`,
          'Wanted: env-mapped inputs (no ${{ in run bodies), SHA-pinned dated uses:, permissions: + concurrency: present.',
          'Fix: map the input into env: and reference it as "$VAR" in the run body; pin and date the action.',
        ].join('\n'),
      )
    }
  }
  if (failures.length > 0) {
    logger.fail(failures.join('\n\n'))
    process.exitCode = 1
    return
  }
  logger.success(
    `release-kit workflow templates are env-mapped — ${files.length} template(s) checked.`,
  )
}

main()
