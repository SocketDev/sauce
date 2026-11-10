#!/usr/bin/env node
/**
 * Generate every agent plugin from skills/ and .claude-plugin/plugin.json.
 *
 * Usage: node scripts/repo/plugins/generate.mts [--check] [--sign-in-only]
 * [--target <id>]
 *
 * --sign-in-only writes only the shared sign-in doc, so publish.mts can
 * inline it into skills before the targets copy them.
 */

import { existsSync } from 'node:fs'
import * as path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule, runMain } from '../util/main.mts'
import type { ScriptMeta } from '../util/main.mts'
import { ArtifactWriter } from './output.mts'
import type { ArtifactReport } from './output.mts'
import { PLUGIN_TARGETS, SIGN_IN_DOC } from './registry.mts'
import { discoverSkills, findInlineShell } from './skills.mts'
import { readPluginIdentity, SOCKET_MCP } from './socket.mts'
import type { PluginContext, PluginTarget } from './target.mts'

const logger = getDefaultLogger()

export interface GeneratePluginsOptions {
  check?: boolean | undefined
  signInOnly?: boolean | undefined
  targets?: readonly PluginTarget[] | undefined
}

export function buildPluginContext(
  root: string,
  out: ArtifactWriter,
): PluginContext {
  const skills = discoverSkills(root)
  if (skills.length === 0) {
    throw new Error('No skills discovered under skills/**/SKILL.md')
  }
  const inlineShell = findInlineShell(skills)
  if (inlineShell.length > 0) {
    throw new Error(
      `Skills hold an inline !\`command\` snippet, which Claude Code and Hermes Agent run as a shell command:\n${inlineShell.map(f => `  - ${f}`).join('\n')}`,
    )
  }
  return { root, identity: readPluginIdentity(root), skills, out }
}

function listFormat(items: readonly string[]): string {
  if (items.length <= 2) {
    return items.join(' and ')
  }
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

/**
 * The socket-connect sign-in section: which plugins add the server, the
 * per-agent sign-in table, and the commands that add the server by hand.
 */
export function renderSignInDoc(
  targets: readonly PluginTarget[] = PLUGIN_TARGETS,
): string {
  const lines: string[] = []
  const bundling = targets
    .filter(t => t.connect.bundlesServer)
    .map(t => t.agent)
  const others = targets.filter(t => !t.connect.bundlesServer).map(t => t.agent)
  if (bundling.length > 0) {
    lines.push(
      `The ${listFormat(bundling)} plugins add the hosted Socket MCP server (\`${SOCKET_MCP.url}\`) for you. ` +
        (others.length > 0
          ? `In ${listFormat(others)}, or when the skills are installed without a plugin, add it once as shown below.`
          : 'When the skills are installed without a plugin, add it once as shown below.'),
      '',
    )
  }
  const rows = targets.flatMap(target =>
    target.connect.signIn.map(r => ({
      agent: r.agent ?? target.agent,
      howTo: r.howTo,
    })),
  )
  const agentWidth = Math.max('Agent'.length, ...rows.map(r => r.agent.length))
  const howWidth = Math.max(
    'How to sign in'.length,
    ...rows.map(r => r.howTo.length),
  )
  const row = (a: string, b: string): string =>
    `| ${a.padEnd(agentWidth)} | ${b.padEnd(howWidth)} |`
  lines.push(
    row('Agent', 'How to sign in'),
    `| ${'-'.repeat(agentWidth)} | ${'-'.repeat(howWidth)} |`,
    ...rows.map(r => row(r.agent, r.howTo)),
  )
  const adds = targets.flatMap(target =>
    target.connect.addServer ? [target.connect.addServer] : [],
  )
  if (adds.length > 0) {
    lines.push('', 'If the Socket server is not listed at all, add it by URL.')
    for (const add of adds) {
      lines.push('', add.intro, '', '```shell', add.command, '```')
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Fail with one message naming every hand-maintained source the targets
 * need that is missing.
 */
export function checkSources(
  root: string,
  targets: readonly PluginTarget[],
): void {
  const missing = targets.flatMap(target =>
    target.sources
      .filter(rel => !existsSync(path.join(root, ...rel.split('/'))))
      .map(rel => `${target.agent}: ${rel}`),
  )
  if (missing.length > 0) {
    throw new Error(
      `Plugin sources are missing; restore them, they are hand-maintained:\n${missing.map(m => `  - ${m}`).join('\n')}`,
    )
  }
}

/**
 * The targets the command line selects: all of them, or the one `--target`
 * names.
 */
export function selectTargets(
  args: readonly string[],
): readonly PluginTarget[] {
  const index = args.indexOf('--target')
  if (index === -1) {
    return PLUGIN_TARGETS
  }
  const id = args[index + 1]
  const selected = PLUGIN_TARGETS.filter(target => target.id === id)
  if (selected.length === 0) {
    throw new Error(
      `Unknown target ${JSON.stringify(id)}. Known: ${PLUGIN_TARGETS.map(t => t.id).join(', ')}`,
    )
  }
  return selected
}

export function generatePlugins(
  root: string,
  options?: GeneratePluginsOptions | undefined,
): ArtifactReport {
  const {
    check = false,
    signInOnly = false,
    targets = PLUGIN_TARGETS,
  } = { __proto__: null, ...options } as GeneratePluginsOptions
  const out = new ArtifactWriter(root, check)
  out.file(SIGN_IN_DOC, renderSignInDoc())
  if (!signInOnly) {
    checkSources(root, targets)
    const ctx = buildPluginContext(root, out)
    for (const target of targets) {
      target.generate(ctx)
    }
  }
  return out.report()
}

function main(): void {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const signInOnly = args.includes('--sign-in-only')
  const targets = selectTargets(args)
  const report = generatePlugins(REPO_ROOT, { check, signInOnly, targets })
  if (check) {
    if (report.outdated.length > 0) {
      logger.fail('Generated plugin artifacts are out of date:')
      for (const item of report.outdated) {
        logger.fail(`  - ${item}`)
      }
      logger.fail('Run: pnpm run generate')
      process.exitCode = 1
      return
    }
    logger.log(
      `Plugin artifacts are up to date (${targets.map(t => t.agent).join(', ')}).`,
    )
    return
  }
  for (const item of report.removed) {
    logger.log(`Removed ${item}`)
  }
  logger.log(
    `Generated ${signInOnly ? SIGN_IN_DOC : targets.map(t => t.agent).join(', ')}.`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe: 'generates every agent plugin from skills/',
  help: 'Usage: node scripts/repo/plugins/generate.mts [--check] [--sign-in-only] [--target <id>]',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}
