/**
 * @file Step 5 — staged-config: write the channel workflows (byte-identical
 *   to the LOCAL templates under `scripts/socket-release/templates/` — the
 *   local template is the authority), the four release scripts +
 *   `publishConfig.access` into package.json (JSON-surgical: key order,
 *   2-space indent, trailing newline preserved), and the kit gitignore
 *   block. File writes ONLY, no commits — the operator commits (worktree
 *   hygiene). A workflow whose bytes diverge from its template is a CONFLICT
 *   refusal; `--force` (accepted only by this step) restores the kit
 *   version.
 */

import path from 'node:path'

import type {
  Check,
  Effect,
  StepApplyResult,
  StepContext,
  StepDetection,
  StepPlan,
} from '../plan.mts'
import { KitError } from '../render.mts'
import type { BootstrapSeams } from '../seams.mts'

export const id = 'staged-config' as const

/**
 * The workflow file each channel installs.
 */
export const CHANNEL_WORKFLOWS: Readonly<Record<string, string>> = {
  brew: 'brew-publish.yml',
  crates: 'cargo-publish.yml',
  'github-release': 'github-release.yml',
  npm: 'npm-publish.yml',
}

/**
 * The §3.2 scripts every consumer carries, exact strings.
 */
export const KIT_SCRIPTS: Readonly<Record<string, string>> = {
  prepublishOnly:
    "echo 'ERROR: publish via the socket-release kit (scripts/socket-release)' && exit 1",
  release: 'node scripts/socket-release/bootstrap.mts',
  'release:npm': 'node scripts/socket-release/npm-publish.mts',
  'release:status': 'node scripts/socket-release/bootstrap.mts --status',
}

/**
 * The kit gitignore block, exactly two lines.
 */
export const GITIGNORE_BLOCK = '# socket-release-kit\n.cache/\n'

export function workflowsForChannels(channels: readonly string[]): string[] {
  const files = new Set<string>()
  for (let i = 0, { length } = channels; i < length; i += 1) {
    const f = CHANNEL_WORKFLOWS[channels[i]!]
    if (f) {
      files.add(f)
    }
  }
  return [...files]
}

export interface StagedConfigItem {
  id: string
  source?: string | undefined
  state: 'conflict' | 'missing' | 'ok'
  target?: string | undefined
}

export interface StagedConfigInputs {
  gitignore: string | undefined
  packageJsonRaw: string | undefined
  targets: Record<string, string | undefined>
  templates: Record<string, string | undefined>
}

export async function read(
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<StagedConfigInputs> {
  const files = workflowsForChannels(ctx.channels)
  const templates: Record<string, string | undefined> = {}
  const targets: Record<string, string | undefined> = {}
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    templates[f] = seams.readFile(
      path.join(ctx.repoRoot, 'scripts/socket-release/templates/workflows', f),
    )
    targets[f] = seams.readFile(path.join(ctx.repoRoot, '.github/workflows', f))
  }
  return {
    gitignore: seams.readFile(path.join(ctx.repoRoot, '.gitignore')),
    packageJsonRaw: seams.readFile(path.join(ctx.repoRoot, 'package.json')),
    targets,
    templates,
  }
}

/**
 * JSON-surgical package.json edit: parse, add the missing script entries and
 * publishConfig.access, re-serialize with 2-space indent + trailing newline.
 * JS object insertion order is preserved for string keys, so existing key
 * order survives; new keys append to their object. Pure — exported for
 * tests.
 */
export function editPackageJsonRaw(
  raw: string,
  access: string,
): { changed: boolean; next: string } {
  const pkg = JSON.parse(raw) as Record<string, unknown>
  let changed = false
  const scripts =
    typeof pkg['scripts'] === 'object' && pkg['scripts'] !== null
      ? (pkg['scripts'] as Record<string, unknown>)
      : {}
  for (const [name, body] of Object.entries(KIT_SCRIPTS)) {
    if (scripts[name] !== body) {
      scripts[name] = body
      changed = true
    }
  }
  pkg['scripts'] = scripts
  const publishConfig =
    typeof pkg['publishConfig'] === 'object' && pkg['publishConfig'] !== null
      ? (pkg['publishConfig'] as Record<string, unknown>)
      : {}
  if (publishConfig['access'] !== access) {
    publishConfig['access'] = access
    changed = true
  }
  pkg['publishConfig'] = publishConfig
  return { changed, next: `${JSON.stringify(pkg, null, 2)}\n` }
}

/**
 * Whether package.json already carries the exact §3.2 entries. Pure.
 */
export function packageJsonConforms(
  raw: string | undefined,
  access: string,
): boolean {
  if (raw === undefined) {
    return false
  }
  try {
    const pkg = JSON.parse(raw) as {
      publishConfig?: { access?: unknown } | undefined
      scripts?: Record<string, unknown> | undefined
    }
    return (
      Object.entries(KIT_SCRIPTS).every(
        ([name, body]) => pkg.scripts?.[name] === body,
      ) && pkg.publishConfig?.access === access
    )
  } catch {
    return false
  }
}

/**
 * Classify the staged-config surface: per-workflow byte parity vs the LOCAL
 * template, the package.json entries, and the gitignore block. Pure —
 * exported for tests.
 */
export function classifyStagedConfig(
  inputs: StagedConfigInputs,
  ctx: StepContext,
): StepDetection {
  const checks: Check[] = []
  const items: StagedConfigItem[] = []
  const files = workflowsForChannels(ctx.channels)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    const template = inputs.templates[f]
    const target = inputs.targets[f]
    const state: StagedConfigItem['state'] =
      template === undefined
        ? 'missing'
        : target === undefined
          ? 'missing'
          : target === template
            ? 'ok'
            : 'conflict'
    items.push({ id: `workflow-${f}`, state })
    checks.push({
      fix:
        state === 'ok'
          ? null
          : template === undefined
            ? 'run the installer again — the local template is missing (node release-kit/install.mts --verify names the gap).'
            : state === 'conflict'
              ? 'reconcile your edits into the template question first, or re-run `bootstrap staged-config --apply --force` to restore the kit version.'
              : 'run: node scripts/socket-release/bootstrap.mts staged-config --apply',
      id: `workflow-${f}`,
      ok: state === 'ok',
      saw:
        state === 'ok'
          ? 'byte-identical to the local template'
          : state === 'conflict'
            ? 'bytes differing from the local template'
            : template === undefined
              ? 'local template missing'
              : 'workflow not installed',
      wanted: `.github/workflows/${f} byte-identical to scripts/socket-release/templates/workflows/${f}`,
    })
  }
  const access = ctx.access ?? 'restricted'
  const pkgOk = packageJsonConforms(inputs.packageJsonRaw, access)
  checks.push({
    fix: pkgOk
      ? null
      : 'run: node scripts/socket-release/bootstrap.mts staged-config --apply',
    id: 'package-json-scripts',
    ok: pkgOk,
    saw: pkgOk
      ? 'all four kit scripts + publishConfig.access present'
      : 'kit scripts or publishConfig.access missing/divergent',
    wanted: `release, release:status, release:npm, prepublishOnly scripts + publishConfig.access ${access}`,
  })
  const gitignoreOk =
    inputs.gitignore !== undefined &&
    inputs.gitignore.includes(GITIGNORE_BLOCK.trimEnd())
  checks.push({
    fix: gitignoreOk
      ? null
      : 'run: node scripts/socket-release/bootstrap.mts staged-config --apply',
    id: 'gitignore-block',
    ok: gitignoreOk,
    saw: gitignoreOk ? 'kit block present' : 'kit block absent',
    wanted: 'a `# socket-release-kit` + `.cache/` block in .gitignore',
  })
  const failing = checks.filter(c => !c.ok)
  const conflicts = items.filter(i => i.state === 'conflict')
  return {
    checks,
    detail:
      failing.length === 0
        ? 'staged-config surface is byte-complete'
        : conflicts.length > 0 && !ctx.force
          ? `${conflicts.length} workflow(s) diverge from their template — refusing to overwrite without --force`
          : `${failing.length} staged-config item(s) pending`,
    done: failing.length === 0,
    state:
      failing.length === 0
        ? 'ok'
        : conflicts.length > 0
          ? 'conflict'
          : 'pending',
  }
}

export function classify(inputs: unknown, ctx: StepContext): StepDetection {
  return classifyStagedConfig(inputs as StagedConfigInputs, ctx)
}

export function plan(detection: StepDetection, ctx: StepContext): StepPlan {
  if (detection.done) {
    return { effects: [] }
  }
  const effects: Effect[] = []
  for (let i = 0, { length } = detection.checks; i < length; i += 1) {
    const c = detection.checks[i]!
    if (c.ok) {
      continue
    }
    if (c.id.startsWith('workflow-')) {
      const f = c.id.slice('workflow-'.length)
      effects.push({
        applied: false,
        description: `write .github/workflows/${f} from scripts/socket-release/templates/workflows/${f}${ctx.force ? ' (force restore)' : ''}`,
        kind: 'file-write',
      })
    } else if (c.id === 'package-json-scripts') {
      effects.push({
        applied: false,
        description:
          'surgical package.json edit: add the four kit scripts + publishConfig.access',
        kind: 'file-write',
      })
    } else if (c.id === 'gitignore-block') {
      effects.push({
        applied: false,
        description: 'append the kit block to .gitignore',
        kind: 'file-write',
      })
    }
  }
  return { effects }
}

export async function apply(
  stepPlan: StepPlan,
  ctx: StepContext,
  seams: BootstrapSeams,
): Promise<StepApplyResult> {
  if (stepPlan.effects.length === 0) {
    return { effects: [] }
  }
  const inputs = await read(ctx, seams)
  const detection = classifyStagedConfig(inputs, ctx)
  const files = workflowsForChannels(ctx.channels)
  const effects: Effect[] = []
  // Conflict pre-scan: refuse BEFORE any write so a conflicted run performs
  // zero writes, not a partial set.
  if (!ctx.force) {
    for (let i = 0, { length } = files; i < length; i += 1) {
      const f = files[i]!
      const template = inputs.templates[f]
      const target = inputs.targets[f]
      if (
        template !== undefined &&
        target !== undefined &&
        target !== template
      ) {
        throw new KitError(
          {
            fix: 'reconcile your edits into the template question first, or re-run `bootstrap staged-config --apply --force` to restore the kit version.',
            saw: `bytes differing from scripts/socket-release/templates/workflows/${f}`,
            wanted: 'the kit-managed workflow, byte-identical to its template',
            what: 'Refusing to overwrite a hand-edited workflow.',
            where: `.github/workflows/${f}`,
          },
          1,
        )
      }
    }
  }
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    const template = inputs.templates[f]
    const target = inputs.targets[f]
    if (template === undefined) {
      throw new KitError(
        {
          fix: 'run the installer again (node release-kit/install.mts --target . --channels <channels> --apply) to restore the local templates.',
          saw: 'no such file',
          wanted: 'the channel workflow template installed with the kit',
          what: `Local template scripts/socket-release/templates/workflows/${f} is missing.`,
          where: path.join(
            ctx.repoRoot,
            'scripts/socket-release/templates/workflows',
            f,
          ),
        },
        1,
      )
    }
    if (target === template) {
      continue
    }
    if (target !== undefined && !ctx.force) {
      throw new KitError(
        {
          fix: 'reconcile your edits into the template question first, or re-run `bootstrap staged-config --apply --force` to restore the kit version.',
          saw: `bytes differing from scripts/socket-release/templates/workflows/${f}`,
          wanted: 'the kit-managed workflow, byte-identical to its template',
          what: 'Refusing to overwrite a hand-edited workflow.',
          where: `.github/workflows/${f}`,
        },
        1,
      )
    }
    seams.writeFile(path.join(ctx.repoRoot, '.github/workflows', f), template)
    effects.push({
      applied: true,
      description: `write .github/workflows/${f} from scripts/socket-release/templates/workflows/${f}${target !== undefined ? ' (force restore)' : ''}`,
      kind: 'file-write',
    })
  }
  const access = ctx.access ?? 'restricted'
  if (
    inputs.packageJsonRaw !== undefined &&
    !packageJsonConforms(inputs.packageJsonRaw, access)
  ) {
    const edit = editPackageJsonRaw(inputs.packageJsonRaw, access)
    if (edit.changed) {
      seams.writeFile(path.join(ctx.repoRoot, 'package.json'), edit.next)
      effects.push({
        applied: true,
        description:
          'surgical package.json edit: add the four kit scripts + publishConfig.access',
        kind: 'file-write',
      })
    }
  }
  const gitignoreOk = detection.checks.find(c => c.id === 'gitignore-block')?.ok
  if (!gitignoreOk) {
    const current = inputs.gitignore ?? ''
    const next =
      current === '' || current.endsWith('\n')
        ? `${current}${GITIGNORE_BLOCK}`
        : `${current}\n${GITIGNORE_BLOCK}`
    seams.writeFile(path.join(ctx.repoRoot, '.gitignore'), next)
    effects.push({
      applied: true,
      description: 'append the kit block to .gitignore',
      kind: 'file-write',
    })
  }
  return { effects }
}
