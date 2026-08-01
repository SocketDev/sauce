/**
 * @file Staged-config detection + writes: byte-parity against the REAL
 *   payload templates, the divergent-workflow conflict refusal with zero
 *   writes, --force restore to byte-identity, the surgical package.json
 *   edit (key order / indent / trailing newline), and append-only-if-absent
 *   gitignore.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as stagedConfig from '../../../../../../release-kit/payload/scripts/socket-release/bootstrap/steps/staged-config.mts'
import { KitError } from '../../../../../../release-kit/payload/scripts/socket-release/bootstrap/render.mts'
import { fakeSeams, makeCtx } from '../../helpers.mts'

const PAYLOAD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../release-kit/payload/scripts/socket-release',
)
const NPM_TEMPLATE = readFileSync(
  path.join(PAYLOAD, 'templates/workflows/npm-publish.yml'),
  'utf8',
)
const GHR_TEMPLATE = readFileSync(
  path.join(PAYLOAD, 'templates/workflows/github-release.yml'),
  'utf8',
)

const ROOT = '/tmp/example-repo'
const T = (rel: string) => path.join(ROOT, rel)

const CONFORMING_PKG = `${JSON.stringify(
  {
    name: '@socketsecurity/example',
    version: '1.0.0',
    scripts: {
      build: 'echo build',
      ...stagedConfig.KIT_SCRIPTS,
    },
    publishConfig: { access: 'restricted' },
  },
  null,
  2,
)}\n`

function conformingFiles(): Record<string, string> {
  return {
    [T('.github/workflows/github-release.yml')]: GHR_TEMPLATE,
    [T('.github/workflows/npm-publish.yml')]: NPM_TEMPLATE,
    [T('.gitignore')]: `node_modules/\n${stagedConfig.GITIGNORE_BLOCK}`,
    [T('package.json')]: CONFORMING_PKG,
    [T('scripts/socket-release/templates/workflows/github-release.yml')]:
      GHR_TEMPLATE,
    [T('scripts/socket-release/templates/workflows/npm-publish.yml')]:
      NPM_TEMPLATE,
  }
}

async function classifyWith(files: Record<string, string>, ctx = makeCtx()) {
  const fake = fakeSeams({ files })
  const inputs = await stagedConfig.read(ctx, fake.seams)
  return { detection: stagedConfig.classifyStagedConfig(inputs, ctx), fake }
}

describe('classifyStagedConfig', () => {
  it('byte-identical surface is done with every check ok', async () => {
    const { detection } = await classifyWith(conformingFiles())
    expect(detection.done).toBe(true)
    expect(detection.checks.filter(c => !c.ok)).toEqual([])
  })

  it('a missing workflow is pending, not a conflict', async () => {
    const files = conformingFiles()
    delete files[T('.github/workflows/npm-publish.yml')]
    const { detection } = await classifyWith(files)
    expect(detection.state).toBe('pending')
    expect(
      detection.checks.find(c => c.id === 'workflow-npm-publish.yml')?.saw,
    ).toBe('workflow not installed')
  })

  it('divergent bytes classify as conflict', async () => {
    const files = conformingFiles()
    files[T('.github/workflows/npm-publish.yml')] = `${NPM_TEMPLATE}# edited\n`
    const { detection } = await classifyWith(files)
    expect(detection.state).toBe('conflict')
  })
})

describe('apply', () => {
  it('divergent workflow without --force refuses with the §6 fields and ZERO writes', async () => {
    const files = conformingFiles()
    files[T('.github/workflows/npm-publish.yml')] = `${NPM_TEMPLATE}# edited\n`
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({ files })
    const inputs = await stagedConfig.read(ctx, fake.seams)
    const plan = stagedConfig.plan(
      stagedConfig.classifyStagedConfig(inputs, ctx),
      ctx,
    )
    try {
      await stagedConfig.apply(plan, ctx, fake.seams)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(KitError)
      const err = e as KitError
      expect(err.exitCode).toBe(1)
      expect(err.fields.what).toBe(
        'Refusing to overwrite a hand-edited workflow.',
      )
      expect(err.fields.where).toBe('.github/workflows/npm-publish.yml')
      expect(err.fields.fix).toContain('--force')
    }
    expect(Object.keys(fake.written)).toEqual([])
  })

  it('--force restores byte-identity to the template', async () => {
    const files = conformingFiles()
    files[T('.github/workflows/npm-publish.yml')] = `${NPM_TEMPLATE}# edited\n`
    const ctx = makeCtx({ apply: true, force: true })
    const fake = fakeSeams({ files })
    const inputs = await stagedConfig.read(ctx, fake.seams)
    const plan = stagedConfig.plan(
      stagedConfig.classifyStagedConfig(inputs, ctx),
      ctx,
    )
    await stagedConfig.apply(plan, ctx, fake.seams)
    expect(fake.written[T('.github/workflows/npm-publish.yml')]).toBe(
      NPM_TEMPLATE,
    )
  })

  it('writes missing workflows byte-identical and appends the gitignore block once', async () => {
    const files = conformingFiles()
    delete files[T('.github/workflows/npm-publish.yml')]
    files[T('.gitignore')] = 'node_modules/\n'
    const ctx = makeCtx({ apply: true })
    const fake = fakeSeams({ files })
    const inputs = await stagedConfig.read(ctx, fake.seams)
    const plan = stagedConfig.plan(
      stagedConfig.classifyStagedConfig(inputs, ctx),
      ctx,
    )
    await stagedConfig.apply(plan, ctx, fake.seams)
    expect(fake.written[T('.github/workflows/npm-publish.yml')]).toBe(
      NPM_TEMPLATE,
    )
    expect(fake.written[T('.gitignore')]).toBe(
      `node_modules/\n${stagedConfig.GITIGNORE_BLOCK}`,
    )
    // Re-run: detection over the written state plans nothing.
    const again = await stagedConfig.read(ctx, fake.seams)
    expect(stagedConfig.classifyStagedConfig(again, ctx).done).toBe(true)
  })
})

describe('editPackageJsonRaw (surgical)', () => {
  it('preserves key order and indent, appends the kit entries, trailing newline', () => {
    const raw = `${JSON.stringify(
      {
        name: 'x',
        version: '1.0.0',
        zeta: true,
        scripts: { build: 'echo', test: 'vitest run' },
        alpha: 1,
      },
      null,
      2,
    )}\n`
    const { changed, next } = stagedConfig.editPackageJsonRaw(raw, 'restricted')
    expect(changed).toBe(true)
    expect(next.endsWith('\n')).toBe(true)
    const keys = Object.keys(JSON.parse(next) as Record<string, unknown>)
    // Existing top-level order preserved; publishConfig appended.
    expect(keys.slice(0, 5)).toEqual([
      'name',
      'version',
      'zeta',
      'scripts',
      'alpha',
    ])
    expect(keys.at(-1)).toBe('publishConfig')
    const scripts = (JSON.parse(next) as { scripts: Record<string, string> })
      .scripts
    expect(Object.keys(scripts).slice(0, 2)).toEqual(['build', 'test'])
    expect(scripts['release']).toBe('node scripts/socket-release/bootstrap.mts')
  })

  it('is idempotent — a conforming manifest changes nothing', () => {
    const first = stagedConfig.editPackageJsonRaw(
      '{"name":"x","version":"1.0.0"}\n',
      'restricted',
    )
    const second = stagedConfig.editPackageJsonRaw(first.next, 'restricted')
    expect(second.changed).toBe(false)
    expect(second.next).toBe(first.next)
  })
})
