// Specs for scripts/repo/generate-hermes-plugin.mts.
//
// The generator copies every skill under skills/, at any depth, into its own
// top-level hermes/skills/<name>/ byte for byte, writes an Agent Plugins v1
// manifest, never writes an mcp.json, never touches the hand-maintained
// README, and refuses anything Hermes's loader or install scanner would
// reject.

import { describe, expect, it } from 'vitest'

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import {
  AGENT_PLUGINS_SCHEMA_V1,
  buildHermesPluginManifest,
  collectHermesSkillFiles,
  collectHermesSkills,
  generateHermesPlugin,
  HERMES_MAX_FILE_BYTES,
  HERMES_MAX_FILE_COUNT,
  HERMES_MAX_TOTAL_BYTES,
  HERMES_MCP_ADD_COMMAND,
  HERMES_PLUGIN_NAME,
  validateHermesPlugin,
  validateSkillMd,
} from '../../../scripts/repo/generate-hermes-plugin.mts'
import { renderJson } from '../../../scripts/repo/generate-cursor-plugin.mts'

const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'scripts',
  'repo',
  'generate-hermes-plugin.mts',
)

const README = '# Fixture Hermes README\n'

function skillMd(name: string, description = 'A demo skill.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

function writeFile(root: string, rel: string, content: string | Buffer): void {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function writeSkill(root: string, rel: string, name: string): void {
  writeFile(root, path.join('skills', rel, 'SKILL.md'), skillMd(name))
}

function makeFixtureRoot(
  options: { readme?: boolean; claude?: Record<string, unknown> } = {},
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hermes-plugin-fixture-'))
  writeFile(
    root,
    path.join('.claude-plugin', 'plugin.json'),
    renderJson(
      options.claude ?? {
        name: 'fixture-skills',
        version: '9.9.9',
        description: 'Fixture skills.',
        author: { name: 'Fixture Co' },
        homepage: 'https://example.com/fixture/',
        repository: 'https://example.com/fixture',
        license: 'MIT',
        keywords: ['alpha', 'beta'],
      },
    ),
  )
  writeSkill(root, 'beta', 'beta')
  writeSkill(root, 'alpha', 'alpha')
  writeSkill(root, path.join('alpha', 'alpha-sub'), 'alpha-sub')
  writeFile(
    root,
    path.join('skills', 'alpha', 'alpha-sub', 'references', 'sub.md'),
    '# Sub notes\n',
  )
  writeFile(
    root,
    path.join('skills', 'alpha', 'references', 'notes.md'),
    '# Notes\n',
  )
  writeFile(root, path.join('skills', 'alpha', '_draft.md'), '# Draft\n')
  writeFile(root, path.join('skills', 'alpha', 'references', '_x.md'), 'x')
  writeFile(root, path.join('skills', '_shared', 'docs', 'x.md'), '# Shared\n')
  writeFile(root, path.join('skills', '.codex-plugin', 'plugin.json'), '{}\n')
  writeFile(root, path.join('skills', 'no-skill-md', 'README.md'), '# none\n')
  writeSkill(root, '.hidden', 'hidden')
  writeSkill(root, '_private', 'private')
  writeFile(root, path.join('skills', 'alpha', '.DS_Store'), 'junk')
  if (options.readme !== false) {
    writeFile(root, path.join('hermes', 'README.md'), README)
  }
  return root
}

function withFixture(
  fn: (root: string) => void,
  options?: Parameters<typeof makeFixtureRoot>[0],
): void {
  const root = makeFixtureRoot(options)
  try {
    fn(root)
  } finally {
    safeDeleteSync(root)
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

function validateFixture(root: string): string[] {
  return validateHermesPlugin(
    buildHermesPluginManifest({ root }),
    collectHermesSkillFiles({ root }),
  )
}

const EXPECTED_FILES = [
  'alpha/SKILL.md',
  'alpha/references/notes.md',
  'alpha-sub/SKILL.md',
  'alpha-sub/references/sub.md',
  'beta/SKILL.md',
]

describe('buildHermesPluginManifest', () => {
  it('writes an Agent Plugins v1 manifest named socket', () => {
    withFixture(root => {
      expect(buildHermesPluginManifest({ root })).toStrictEqual({
        $schema: AGENT_PLUGINS_SCHEMA_V1,
        name: HERMES_PLUGIN_NAME,
        version: '9.9.9',
        description: 'Fixture skills.',
        author: { name: 'Fixture Co', url: 'https://socket.dev' },
        homepage: 'https://example.com/fixture/tree/main/hermes',
        repository: 'https://example.com/fixture',
        license: 'MIT',
        keywords: ['alpha', 'beta', 'hermes'],
      })
    })
  })

  it('uses only fields Hermes accepts', () => {
    withFixture(root => {
      const allowed = new Set([
        '$schema',
        'name',
        'version',
        'description',
        'author',
        'homepage',
        'repository',
        'license',
        'keywords',
        'extensions',
      ])
      const manifest = buildHermesPluginManifest({ root })
      for (const key of Object.keys(manifest)) {
        expect(allowed.has(key), key).toBe(true)
      }
      const author = manifest['author'] as Record<string, unknown>
      for (const key of Object.keys(author)) {
        expect(['name', 'email', 'url']).toContain(key)
      }
    })
  })

  it('does not duplicate an existing hermes keyword and drops non-strings', () => {
    withFixture(
      root => {
        expect(buildHermesPluginManifest({ root })['keywords']).toStrictEqual([
          'x',
          'hermes',
        ])
      },
      { claude: { name: 'n', keywords: ['x', 'hermes', 3] } },
    )
  })

  it('omits optional fields the Claude manifest lacks or mistypes', () => {
    withFixture(
      root => {
        expect(buildHermesPluginManifest({ root })).toStrictEqual({
          $schema: AGENT_PLUGINS_SCHEMA_V1,
          name: HERMES_PLUGIN_NAME,
        })
      },
      { claude: { name: 'n', version: 1, author: 'Someone', keywords: 'x' } },
    )
  })

  it('omits author when its name is not a string', () => {
    withFixture(
      root => {
        expect(buildHermesPluginManifest({ root })).not.toHaveProperty('author')
      },
      { claude: { name: 'n', author: { name: 5 } } },
    )
  })
})

describe('collectHermesSkills', () => {
  it('finds skills at every depth, named by directory, in code-point order', () => {
    withFixture(root => {
      expect(collectHermesSkills({ root })).toStrictEqual([
        { name: 'alpha', sourceDir: path.join(root, 'skills', 'alpha') },
        {
          name: 'alpha-sub',
          sourceDir: path.join(root, 'skills', 'alpha', 'alpha-sub'),
        },
        { name: 'beta', sourceDir: path.join(root, 'skills', 'beta') },
      ])
    })
  })

  it('refuses two skills that flatten to the same name', () => {
    withFixture(root => {
      writeSkill(root, path.join('beta', 'alpha-sub'), 'alpha-sub')
      expect(() => collectHermesSkills({ root })).toThrow(
        /flatten to the same Hermes directory 'alpha-sub'/,
      )
    })
  })

  it('refuses a symlinked skill directory', () => {
    withFixture(root => {
      symlinkSync(
        path.join(root, 'skills', 'beta'),
        path.join(root, 'skills', 'gamma'),
      )
      expect(() => collectHermesSkills({ root })).toThrow(/symlinks/)
    })
  })

  it('returns nothing when skills/ is missing', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'hermes-empty-'))
    try {
      expect(collectHermesSkills({ root })).toStrictEqual([])
      expect(collectHermesSkillFiles({ root }).size).toBe(0)
    } finally {
      safeDeleteSync(root)
    }
  })
})

describe('collectHermesSkillFiles', () => {
  it('flattens nested skills and keeps them out of their parent', () => {
    withFixture(root => {
      expect([...collectHermesSkillFiles({ root }).keys()]).toStrictEqual(
        EXPECTED_FILES,
      )
    })
  })

  it('maps every entry to its source file', () => {
    withFixture(root => {
      const files = collectHermesSkillFiles({ root })
      expect(files.get('alpha-sub/SKILL.md')).toBe(
        path.join(root, 'skills', 'alpha', 'alpha-sub', 'SKILL.md'),
      )
      expect(files.get('alpha/references/notes.md')).toBe(
        path.join(root, 'skills', 'alpha', 'references', 'notes.md'),
      )
      for (const source of files.values()) {
        expect(source.startsWith(path.join(root, 'skills'))).toBe(true)
      }
    })
  })

  it('refuses a symlinked file inside a skill', () => {
    withFixture(root => {
      symlinkSync(
        path.join(root, 'skills', 'beta', 'SKILL.md'),
        path.join(root, 'skills', 'alpha', 'link.md'),
      )
      expect(() => collectHermesSkillFiles({ root })).toThrow(/symlinks/)
    })
  })
})

describe('validateSkillMd', () => {
  const ok = (body: string) => validateSkillMd('demo', `---\n${body}\n---\n`)

  it('accepts plain, folded, and quoted scalars', () => {
    expect(ok('name: demo\ndescription: Plain text.')).toStrictEqual([])
    expect(
      ok('name: demo\ndescription:\n  Folded across\n  two lines.'),
    ).toStrictEqual([])
    expect(ok(`name: "demo"\ndescription: 'It''s quoted: fine'`)).toStrictEqual(
      [],
    )
    expect(
      ok('name: demo\ndescription: x\ndisable-model-invocation: true'),
    ).toStrictEqual([])
    expect(ok('name: demo\ndescription: x\nlicense: MIT')).toStrictEqual([])
    expect(
      ok('name: demo\ndescription: x\ncompatibility: Node 24+'),
    ).toStrictEqual([])
    expect(
      ok('name: demo\ndescription: x\nallowed-tools: Read Bash'),
    ).toStrictEqual([])
  })

  it('rejects an indented line before any key', () => {
    expect(
      validateSkillMd('demo', '---\n  oops\nname: demo\ndescription: x\n---\n'),
    ).toStrictEqual(['unexpected indented line: "  oops"'])
  })

  it('strips a byte-order mark like Hermes does', () => {
    expect(
      validateSkillMd('demo', '﻿---\nname: demo\ndescription: x\n---\n'),
    ).toStrictEqual([])
  })

  it('accepts a description of exactly 1024 characters and a 64-character name', () => {
    const name = 'a'.repeat(64)
    expect(
      validateSkillMd(
        name,
        `---\nname: ${name}\ndescription: ${'x'.repeat(1024)}\n---\n`,
      ),
    ).toStrictEqual([])
  })

  it.each([
    ['no frontmatter', '# demo\n', 'missing YAML frontmatter'],
    [
      'a closing fence at EOF without a newline',
      '---\nname: demo\ndescription: x\n---',
      'unterminated YAML frontmatter',
    ],
  ])('rejects %s', (_label, text, message) => {
    expect(validateSkillMd('demo', text)).toStrictEqual([message])
  })

  it.each([
    ['an empty quoted description', 'description: ""', 'description must be'],
    ['a null description', 'description: null', 'description must be'],
    ['a tilde description', 'description: ~', 'description must be'],
    ['a numeric description', 'description: 123', 'description must be'],
    ['a boolean description', 'description: yes', 'description must be'],
    ['a missing description', 'license: MIT', 'description must be'],
    ['an empty description', 'description:', 'description must be'],
    [
      'a description over 1024 characters',
      `description: ${'x'.repeat(1025)}`,
      'description must be',
    ],
    [
      'an unquoted colon-space',
      'description: Use it: scan deps',
      "must not contain ': '",
    ],
    [
      'an unquoted colon-space on a continuation line',
      'description:\n  first line\n  then: oops',
      "must not contain ': '",
    ],
    ['an unquoted comment marker', 'description: scan deps # and more', "' #'"],
    ['a block scalar', 'description: >\n  folded', 'not a plain YAML scalar'],
    ['a flow sequence', 'description: [a, b]', 'not a plain YAML scalar'],
    ['an anchor', 'description: &a text', 'not a plain YAML scalar'],
    [
      'a multi-line quoted string',
      'description: "a\n  b"',
      'not a plain YAML scalar',
    ],
    ['a duplicate key', 'description: a\ndescription: b', 'duplicate key'],
    [
      'a non-string license',
      'description: x\nlicense: 1',
      'license must be a string',
    ],
    [
      'a list of allowed-tools',
      'description: x\nallowed-tools: [Read]',
      'not a plain YAML scalar',
    ],
    [
      'a boolean allowed-tools',
      'description: x\nallowed-tools: true',
      'allowed-tools must be a string',
    ],
    [
      'an empty compatibility',
      "description: x\ncompatibility: ''",
      'compatibility must be',
    ],
    [
      'a compatibility over 500 characters',
      `description: x\ncompatibility: ${'c'.repeat(501)}`,
      'compatibility must be',
    ],
    ['metadata', 'description: x\nmetadata: x', 'metadata cannot be checked'],
    [
      'a nested map',
      'description: x\nmetadata:\n  a: b',
      "must not contain ': '",
    ],
    [
      'a line without a key',
      'description: x\njust words',
      'cannot read frontmatter line',
    ],
  ])('rejects %s', (_label, rest, message) => {
    expect(ok(`name: demo\n${rest}`).join('\n')).toContain(message)
  })

  it.each([
    ['a name that differs from its directory', 'other'],
    ['an uppercase name', 'Demo'],
    ['a double hyphen', 'de--mo'],
    ['a trailing hyphen', 'demo-'],
    ['an underscore', 'de_mo'],
    ['a quoted different name', '"other"'],
  ])('rejects %s', (_label, name) => {
    expect(
      validateSkillMd('demo', `---\nname: ${name}\ndescription: x\n---\n`).join(
        '\n',
      ),
    ).toContain("must equal its directory name 'demo'")
  })

  it('rejects a 65-character name even when it matches its directory', () => {
    const name = 'a'.repeat(65)
    expect(
      validateSkillMd(name, `---\nname: ${name}\ndescription: x\n---\n`),
    ).toHaveLength(1)
  })
})

describe('validateHermesPlugin', () => {
  it('accepts the fixture', () => {
    withFixture(root => {
      expect(validateFixture(root)).toStrictEqual([])
    })
  })

  it.each([
    ['Upper'],
    ['has_underscore'],
    ['-leading'],
    ['double--hyphen'],
    ['dots..twice'],
    ['a'.repeat(65)],
  ])('rejects plugin name %j', name => {
    expect(
      validateHermesPlugin(
        { $schema: AGENT_PLUGINS_SCHEMA_V1, name },
        new Map(),
      ),
    ).toStrictEqual([
      `plugin name ${JSON.stringify(name)} is not a valid v1 name`,
    ])
  })

  it('accepts a dotted plugin name', () => {
    expect(
      validateHermesPlugin(
        { $schema: AGENT_PLUGINS_SCHEMA_V1, name: 'socket.dev' },
        new Map(),
      ),
    ).toStrictEqual([])
  })

  it('rejects a missing or different schema', () => {
    expect(validateHermesPlugin({ name: 'ok' }, new Map())).toStrictEqual([
      'plugin.json must declare the Agent Plugins v1 schema',
    ])
  })

  it('applies SKILL.md rules to flattened subskills too', () => {
    withFixture(root => {
      writeFile(
        root,
        path.join('skills', 'alpha', 'alpha-sub', 'SKILL.md'),
        skillMd('different-name'),
      )
      expect(validateFixture(root).join('\n')).toContain(
        'skills/alpha-sub/SKILL.md: name "different-name" must equal its directory name \'alpha-sub\'',
      )
    })
  })

  it('does not apply SKILL.md rules to support files', () => {
    withFixture(root => {
      writeFile(root, path.join('skills', 'beta', 'refs', 'README.md'), 'free')
      expect(validateFixture(root)).toStrictEqual([])
    })
  })

  it('rejects an inline shell snippet that Hermes would run', () => {
    withFixture(root => {
      writeFile(
        root,
        path.join('skills', 'beta', 'refs', 'cmd.md'),
        'Today is !`date`.\n',
      )
      expect(validateFixture(root)).toStrictEqual([
        'skills/beta/refs/cmd.md contains an inline !`command` snippet, which Hermes runs when skills.inline_shell is on',
      ])
    })
  })

  it('accepts a lone exclamation mark in code', () => {
    withFixture(root => {
      writeFile(
        root,
        path.join('skills', 'beta', 'refs', 'cmd.md'),
        'Negate with `!`\nRun `ls`! Then `pwd`.\n',
      )
      expect(validateFixture(root)).toStrictEqual([])
    })
  })

  it('accepts a file of exactly the per-file cap and rejects one byte more', () => {
    withFixture(root => {
      const big = path.join('skills', 'beta', 'big.bin')
      writeFile(root, big, Buffer.alloc(HERMES_MAX_FILE_BYTES))
      expect(validateFixture(root)).toStrictEqual([])
      writeFile(root, big, Buffer.alloc(HERMES_MAX_FILE_BYTES + 1))
      expect(validateFixture(root)).toStrictEqual([
        `skills/beta/big.bin is ${HERMES_MAX_FILE_BYTES + 1} bytes, over Hermes's 1MB cap`,
      ])
    })
  })

  it('counts the manifest and README against the file cap', () => {
    withFixture(root => {
      const manifest = buildHermesPluginManifest({ root })
      const source = collectHermesSkillFiles({ root }).get('beta/SKILL.md')!
      const atCap = new Map<string, string>()
      for (let i = 0; i < HERMES_MAX_FILE_COUNT - 2; i += 1) {
        atCap.set(`beta/f${i}.txt`, source)
      }
      expect(validateHermesPlugin(manifest, atCap)).toStrictEqual([])
      atCap.set('beta/one-more.txt', source)
      expect(validateHermesPlugin(manifest, atCap)).toStrictEqual([
        `plugin has ${HERMES_MAX_FILE_COUNT + 1} files, over Hermes's ${HERMES_MAX_FILE_COUNT}-file cap`,
      ])
    })
  })

  it('counts extra bytes against the total cap', () => {
    withFixture(root => {
      const manifest = buildHermesPluginManifest({ root })
      const files = collectHermesSkillFiles({ root })
      expect(
        validateHermesPlugin(manifest, files, { extraBytes: 0 }),
      ).toStrictEqual([])
      expect(
        validateHermesPlugin(manifest, files, {
          extraBytes: HERMES_MAX_TOTAL_BYTES,
        }).join('\n'),
      ).toMatch(/over Hermes's 10MB cap/)
    })
  })
})

describe('generateHermesPlugin', () => {
  it('writes the manifest and a byte-identical, flattened copy', () => {
    withFixture(root => {
      const result = generateHermesPlugin(root, { check: false })
      expect(result.manifestPath).toBe(path.join(root, 'hermes', 'plugin.json'))
      expect(result.skillsDir).toBe(path.join(root, 'hermes', 'skills'))
      expect(readJson(result.manifestPath)).toStrictEqual(
        buildHermesPluginManifest({ root }),
      )
      expect(readdirSync(result.skillsDir).toSorted()).toStrictEqual([
        'alpha',
        'alpha-sub',
        'beta',
      ])
      expect(
        existsSync(path.join(result.skillsDir, 'alpha', 'alpha-sub')),
      ).toBe(false)
      for (const { 0: rel, 1: source } of collectHermesSkillFiles({ root })) {
        expect(
          readFileSync(path.join(result.skillsDir, ...rel.split('/'))),
        ).toStrictEqual(readFileSync(source))
      }
    })
  })

  it('never writes mcp.json and skips _ and . entries at every depth', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      const hermes = path.join(root, 'hermes')
      expect(readdirSync(hermes).toSorted()).toStrictEqual([
        'README.md',
        'plugin.json',
        'skills',
      ])
      const skills = path.join(hermes, 'skills')
      for (const rel of [
        '_shared',
        '_private',
        '.hidden',
        '.codex-plugin',
        'no-skill-md',
        'alpha/.DS_Store',
        'alpha/_draft.md',
        'alpha/references/_x.md',
      ]) {
        expect(existsSync(path.join(skills, ...rel.split('/'))), rel).toBe(
          false,
        )
      }
    })
  })

  it('leaves the hand-maintained README untouched', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      generateHermesPlugin(root, { check: false })
      expect(
        readFileSync(path.join(root, 'hermes', 'README.md'), 'utf-8'),
      ).toBe(README)
    })
  })

  it('check mode reports every missing file and writes nothing', () => {
    withFixture(root => {
      const result = generateHermesPlugin(root, { check: true })
      expect(result.outdated.toSorted()).toStrictEqual(
        [
          path.join('hermes', 'plugin.json'),
          ...EXPECTED_FILES.map(rel =>
            path.join('hermes', 'skills', ...rel.split('/')),
          ),
        ].toSorted(),
      )
      expect(readdirSync(path.join(root, 'hermes'))).toStrictEqual([
        'README.md',
      ])
    })
  })

  it('is idempotent', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([])
      const again = generateHermesPlugin(root, { check: false })
      expect(again.outdated).toStrictEqual([])
      expect(again.removed).toStrictEqual([])
    })
  })

  it('reports a skill edit as drift and rewrites it', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      writeFile(
        root,
        path.join('skills', 'beta', 'SKILL.md'),
        skillMd('beta', 'Changed.'),
      )
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([path.join('hermes', 'skills', 'beta', 'SKILL.md')])
      generateHermesPlugin(root, { check: false })
      expect(
        readFileSync(
          path.join(root, 'hermes', 'skills', 'beta', 'SKILL.md'),
          'utf-8',
        ),
      ).toContain('Changed.')
    })
  })

  it('reports and restores an edited or deleted manifest', () => {
    withFixture(root => {
      const { manifestPath } = generateHermesPlugin(root, { check: false })
      const good = readFileSync(manifestPath, 'utf-8')
      writeFileSync(manifestPath, '{}\n')
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([path.join('hermes', 'plugin.json')])
      safeDeleteSync(manifestPath)
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([path.join('hermes', 'plugin.json')])
      generateHermesPlugin(root, { check: false })
      expect(readFileSync(manifestPath, 'utf-8')).toBe(good)
    })
  })

  it('copies non-UTF-8 files byte for byte and notices a flipped byte', () => {
    withFixture(root => {
      const bytes = Buffer.from([0x89, 0x50, 0xff, 0xfe, 0x00, 0xc3])
      writeFile(root, path.join('skills', 'beta', 'logo.bin'), bytes)
      generateHermesPlugin(root, { check: false })
      const target = path.join(root, 'hermes', 'skills', 'beta', 'logo.bin')
      expect(readFileSync(target).equals(bytes)).toBe(true)

      const flipped = Buffer.from(bytes)
      flipped[2] = 0xfd
      writeFileSync(target, flipped)
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([path.join('hermes', 'skills', 'beta', 'logo.bin')])
      generateHermesPlugin(root, { check: false })
      expect(readFileSync(target).equals(bytes)).toBe(true)
    })
  })

  it.skipIf(process.platform === 'win32')(
    'keeps the executable bit in sync',
    () => {
      withFixture(root => {
        const source = path.join(root, 'skills', 'beta', 'run.sh')
        writeFile(root, path.join('skills', 'beta', 'run.sh'), 'echo hi\n')
        chmodSync(source, 0o755)
        generateHermesPlugin(root, { check: false })
        const target = path.join(root, 'hermes', 'skills', 'beta', 'run.sh')
        expect(statSync(target).mode & 0o111).not.toBe(0)

        chmodSync(source, 0o644)
        expect(
          generateHermesPlugin(root, { check: true }).outdated,
        ).toStrictEqual([path.join('hermes', 'skills', 'beta', 'run.sh')])
        generateHermesPlugin(root, { check: false })
        expect(statSync(target).mode & 0o111).toBe(0)
      })
    },
  )

  it('replaces a case-only rename instead of deleting it', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      const refs = path.join(root, 'hermes', 'skills', 'alpha', 'references')
      renameSync(path.join(refs, 'notes.md'), path.join(refs, 'Notes.md'))
      expect(
        generateHermesPlugin(root, { check: true }).outdated.length,
      ).toBeGreaterThan(0)
      generateHermesPlugin(root, { check: false })
      expect(readdirSync(refs)).toStrictEqual(['notes.md'])
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([])
    })
  })

  it('reports, then removes, files whose source is gone, and prunes empty dirs', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      writeFile(root, path.join('hermes', 'skills', 'beta', '.stray'), 'x')
      safeDeleteSync(path.join(root, 'skills', 'alpha'))

      const stale = [
        path.join('hermes', 'skills', 'alpha-sub', 'references', 'sub.md'),
        path.join('hermes', 'skills', 'alpha-sub', 'SKILL.md'),
        path.join('hermes', 'skills', 'alpha', 'references', 'notes.md'),
        path.join('hermes', 'skills', 'alpha', 'SKILL.md'),
        path.join('hermes', 'skills', 'beta', '.stray'),
      ].toSorted()
      expect(
        generateHermesPlugin(root, { check: true }).outdated.toSorted(),
      ).toStrictEqual(stale)
      expect(existsSync(path.join(root, 'hermes', 'skills', 'alpha'))).toBe(
        true,
      )

      const result = generateHermesPlugin(root, { check: false })
      expect(result.removed.toSorted()).toStrictEqual(stale)
      expect(readdirSync(path.join(root, 'hermes', 'skills'))).toStrictEqual([
        'beta',
      ])
      expect(
        generateHermesPlugin(root, { check: true }).outdated,
      ).toStrictEqual([])
    })
  })

  it('removes empty directories but keeps hermes/skills and the README', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      mkdirSync(path.join(root, 'hermes', 'skills', 'beta', 'a', 'b'), {
        recursive: true,
      })
      generateHermesPlugin(root, { check: false })
      expect(existsSync(path.join(root, 'hermes', 'skills', 'beta', 'a'))).toBe(
        false,
      )
      expect(
        existsSync(path.join(root, 'hermes', 'skills', 'beta', 'SKILL.md')),
      ).toBe(true)
      expect(existsSync(path.join(root, 'hermes', 'README.md'))).toBe(true)
    })
  })

  it('reports, but never deletes, stray entries in hermes/', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      const mcp = path.join(root, 'hermes', 'mcp.json')
      writeFileSync(mcp, '{}\n')
      for (const check of [true, false]) {
        expect(generateHermesPlugin(root, { check }).outdated).toStrictEqual([
          path.join('hermes', 'mcp.json'),
        ])
      }
      expect(existsSync(mcp)).toBe(true)
    })
  })

  it('refuses a symlink planted in hermes/skills', () => {
    withFixture(root => {
      generateHermesPlugin(root, { check: false })
      symlinkSync(
        path.join(root, 'skills', 'beta', 'SKILL.md'),
        path.join(root, 'hermes', 'skills', 'beta', 'link.md'),
      )
      expect(() => generateHermesPlugin(root, { check: false })).toThrow(
        /symlinks/,
      )
    })
  })

  it('refuses to run without the hand-maintained README', () => {
    withFixture(
      root => {
        expect(() => generateHermesPlugin(root, { check: false })).toThrow(
          /README is missing/,
        )
        expect(existsSync(path.join(root, 'hermes'))).toBe(false)
      },
      { readme: false },
    )
  })

  it('refuses to write a plugin Hermes would reject', () => {
    withFixture(root => {
      writeFile(root, path.join('skills', 'beta', 'SKILL.md'), skillMd('nope'))
      expect(() => generateHermesPlugin(root, { check: false })).toThrow(
        /Hermes would reject the generated plugin/,
      )
      expect(existsSync(path.join(root, 'hermes', 'plugin.json'))).toBe(false)
    })
  })

  it('counts the README toward the size cap', () => {
    withFixture(root => {
      writeFile(
        root,
        path.join('hermes', 'README.md'),
        Buffer.alloc(HERMES_MAX_TOTAL_BYTES),
      )
      expect(() => generateHermesPlugin(root, { check: false })).toThrow(
        /over Hermes's 10MB cap/,
      )
    })
  })

  it('refuses an empty skills tree', () => {
    withFixture(root => {
      for (const dir of ['alpha', 'beta']) {
        safeDeleteSync(path.join(root, 'skills', dir))
      }
      expect(() => generateHermesPlugin(root, { check: false })).toThrow(
        /No skills discovered/,
      )
    })
  })
})

describe('CLI', () => {
  it('--check exits 0 on the real repository', () => {
    const result = spawnSync(process.execPath, [GENERATOR, '--check'], {
      encoding: 'utf-8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).toContain(
      'Hermes plugin artifacts are up to date.',
    )
  })
})

it('the documented add command turns on OAuth for the hosted server', () => {
  expect(HERMES_MCP_ADD_COMMAND).toBe(
    'hermes mcp add socket --url https://mcp.socket.dev/ --auth oauth',
  )
})
