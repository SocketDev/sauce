/*
 * @file `check --all` gate: every playwright launch in the release-kit
 *   payload goes through the ONE sanctioned session module, with no
 *   automation flags and no bare `chromium.launch`. The scanner logic is the
 *   wheelhouse's proven text scan (comment stripping so a docblock quoting
 *   the launch shape never counts; string literals preserved so an explicit
 *   `--no-sandbox` is still caught). Also asserts the kit's own law module
 *   accepts its own lawful launch shape: `lawViolations(lawfulLaunchOptions())`
 *   must be empty, so the shipped law and the shipped launch can never drift
 *   apart.
 */

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  lawfulLaunchOptions,
  lawViolations,
} from '../../../release-kit/payload/scripts/socket-release/_shared/playwright-law.mts'
import {
  PAYLOAD_ROOT,
  walkPayload,
} from '../../../release-kit/install/effects.mts'

const logger = getDefaultLogger()

/**
 * The ONE payload module allowed to call `launchPersistentContext`.
 */
export const KIT_LAUNCH_ALLOWLIST: readonly string[] = [
  'release-kit/payload/scripts/socket-release/publish-infra/npm/browser-session.mts',
]

const SANCTIONED_IGNORED_DEFAULT_ARGS: readonly string[] = [
  '--enable-automation',
  '--use-mock-keychain',
]

/**
 * `text` with comments blanked (string contents preserved). Pure — exported
 * for tests.
 */
export function stripComments(text: string): string {
  let out = ''
  let i = 0
  const { length } = text
  while (i < length) {
    const two = text.slice(i, i + 2)
    if (two === '//') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? length : nl
      continue
    }
    if (two === '/*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? length : close + 2
      continue
    }
    const ch = text[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch
      i += 1
      while (i < length) {
        const c = text[i]!
        out += c
        i += 1
        if (c === '\\') {
          if (i < length) {
            out += text[i]!
            i += 1
          }
          continue
        }
        if (c === ch) {
          break
        }
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

export function importsPlaywright(text: string): boolean {
  return /from\s+['"]playwright(?:-core)?['"]/.test(text)
}

export interface KitLaunchViolation {
  detail: string
  relPath: string
}

/**
 * Every sanctioned-launch violation in one payload file's text. Pure —
 * exported for tests.
 */
export function scanKitPlaywrightUsage(config: {
  relPath: string
  text: string
}): KitLaunchViolation[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const { relPath } = cfg
  if (!importsPlaywright(cfg.text)) {
    return []
  }
  const text = stripComments(cfg.text)
  const allowed = KIT_LAUNCH_ALLOWLIST.includes(relPath)
  const violations: KitLaunchViolation[] = []
  if (/\bchromiumSandbox\s*:(?!\s*true\b)/.test(text)) {
    violations.push({
      detail: 'sets `chromiumSandbox` to something other than `true`',
      relPath,
    })
  }
  // A quoted launch flag: an opening quote, `--`, one of the sandbox or
  // automation flag names, then the closing quote.
  const sandboxArg =
    /['"]--(?:disable-(?:blink-features|dev-shm-usage|setuid-sandbox)|no-sandbox)['"]/.exec(
      text,
    )
  if (sandboxArg) {
    violations.push({
      detail: `passes the launch flag ${sandboxArg[0]} explicitly`,
      relPath,
    })
  }
  // The ignoreDefaultArgs option with its value: either the literal `true`
  // or a bracketed list, captured for the sanctioned-pair comparison.
  const ignoreArgs = /\bignoreDefaultArgs\s*:\s*(true\b|\[[^\]]*\])/.exec(text)
  if (ignoreArgs) {
    const value = ignoreArgs[1]!
    const entries =
      value === 'true'
        ? undefined
        : [...value.matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1]!)
    const sanctioned =
      entries !== undefined &&
      entries.length === SANCTIONED_IGNORED_DEFAULT_ARGS.length &&
      SANCTIONED_IGNORED_DEFAULT_ARGS.every(flag => entries.includes(flag))
    if (!sanctioned) {
      violations.push({
        detail: `sets ignoreDefaultArgs to ${value.replaceAll(/\s+/g, ' ')} — only the sanctioned pair is lawful`,
        relPath,
      })
    }
  }
  if (/\bchromium\s*\.\s*launch\s*\(/.test(text) && !allowed) {
    violations.push({
      detail: 'calls bare `chromium.launch(` — use the sanctioned session',
      relPath,
    })
  }
  if (/\blaunchPersistentContext\s*\(/.test(text) && !allowed) {
    violations.push({
      detail: `calls launchPersistentContext outside ${KIT_LAUNCH_ALLOWLIST[0]}`,
      relPath,
    })
  }
  return violations
}

function main(): void {
  const failures: string[] = []
  const files = walkPayload().filter(f => f.endsWith('.mts'))
  let scanned = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    const text = readFileSync(path.join(PAYLOAD_ROOT, rel), 'utf8')
    if (!importsPlaywright(text)) {
      continue
    }
    scanned += 1
    const relPath = `release-kit/payload/scripts/socket-release/${rel}`
    const violations = scanKitPlaywrightUsage({ relPath, text })
    for (let v = 0, { length: vl } = violations; v < vl; v += 1) {
      failures.push(
        [
          'What: an unsanctioned playwright launch in the kit payload.',
          `Where: ${violations[v]!.relPath}`,
          `Saw: ${violations[v]!.detail}.`,
          `Wanted: every launch through ${KIT_LAUNCH_ALLOWLIST[0]}.`,
          'Fix: import openNpmBrowserSession from the sanctioned module instead of launching here.',
        ].join('\n'),
      )
    }
  }
  // The kit's own law must accept its own lawful launch shape.
  const drift = lawViolations(lawfulLaunchOptions())
  if (drift.length > 0) {
    failures.push(
      [
        'What: the kit playwright law refuses its own lawful launch options.',
        'Where: release-kit/payload/scripts/socket-release/_shared/playwright-law.mts',
        `Saw: ${drift.join('; ')}`,
        'Wanted: lawViolations(lawfulLaunchOptions()) === []',
        'Fix: reconcile lawfulLaunchOptions with lawViolations in the same commit.',
      ].join('\n'),
    )
  }
  if (failures.length > 0) {
    logger.fail(failures.join('\n\n'))
    process.exitCode = 1
    return
  }
  logger.success(
    `release-kit launches are sanctioned — ${scanned} playwright-importing payload file(s) checked; law self-check clean.`,
  )
}

main()
