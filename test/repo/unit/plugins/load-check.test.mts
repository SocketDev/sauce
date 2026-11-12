// Specs for the load check: the report comparison, the runner with a stand-in
// agent CLI, the helpers targets read agent output with, and the CI matrix.

import { describe, expect, it } from 'vitest'

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MCP_URL_ENV,
  PRODUCTION_MCP_URL,
  resolveEndpoints,
} from '../../../../scripts/repo/plugins/endpoint.mts'
import {
  ciMatrix,
  compareReport,
  formatOutcome,
  inheritedEnv,
  runTargetLoadCheck,
} from '../../../../scripts/repo/plugins/load-check.mts'
import {
  collectUrls,
  findSkillNames,
  parseJsonOutput,
} from '../../../../scripts/repo/plugins/load.mts'
import { PLUGIN_TARGETS } from '../../../../scripts/repo/plugins/registry.mts'
import type {
  LoadCheck,
  PluginTarget,
} from '../../../../scripts/repo/plugins/target.mts'
import { isolateGitEnv } from '../../util/git-env.mts'
import { withFixture } from './fixture.mts'

isolateGitEnv()

const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/repo/plugins/load-check.mts',
)

const PROD = resolveEndpoints({})
const OVERRIDE = resolveEndpoints({
  [MCP_URL_ENV]: 'https://mcp.example-deploy.example.test/',
})

function fakeTarget(
  bundlesServer: boolean,
  loadCheck?: LoadCheck | undefined,
): PluginTarget {
  return {
    ...PLUGIN_TARGETS[0]!,
    id: 'fake',
    agent: 'Fake Agent',
    connect: { bundlesServer, signIn: [{ howTo: 'x' }] },
    loadCheck,
  }
}

function nodeCli(load: LoadCheck['load']): LoadCheck {
  return {
    cli: {
      bin: process.execPath,
      install: { tool: 'npm', spec: 'fake@1.0.0' },
      isolate: home => ({ FAKE_AGENT_HOME: home }),
    },
    load,
  }
}

describe('compareReport', () => {
  it('passes a full report with the server at the endpoint', () => {
    expect(
      compareReport(
        fakeTarget(true),
        ['a', 'b'],
        { skills: ['b', 'a', 'extra'], mcpUrls: ['https://mcp.socket.dev'] },
        PROD,
      ),
    ).toStrictEqual([])
  })

  it('names every missing skill', () => {
    expect(
      compareReport(
        fakeTarget(false),
        ['a', 'b', 'c'],
        { skills: ['b'], mcpUrls: [] },
        PROD,
      ),
    ).toStrictEqual(['did not load 2 skill(s): a, c'])
  })

  it('requires the server when the plugin bundles it', () => {
    expect(
      compareReport(fakeTarget(true), [], { skills: [], mcpUrls: [] }, PROD),
    ).toStrictEqual([
      `did not register the Socket MCP server at ${PRODUCTION_MCP_URL}`,
    ])
  })

  it('flags a build that still points at production under an override', () => {
    expect(
      compareReport(
        fakeTarget(true),
        [],
        { skills: [], mcpUrls: [PRODUCTION_MCP_URL] },
        OVERRIDE,
      ),
    ).toStrictEqual([
      `did not register the Socket MCP server at ${OVERRIDE.mcpUrl}`,
      'still registers the production MCP server',
    ])
  })

  it('does not require a server from a plugin that does not bundle one', () => {
    expect(
      compareReport(fakeTarget(false), [], { skills: [], mcpUrls: [] }, PROD),
    ).toStrictEqual([])
  })
})

describe('runTargetLoadCheck', () => {
  it('skips a target with no load check', () => {
    withFixture(root => {
      expect(runTargetLoadCheck(fakeTarget(false), root, PROD)).toMatchObject({
        status: 'skipped',
        detail: 'no CLI that loads this plugin',
      })
    })
  })

  it('skips a missing CLI, or fails it under --require', () => {
    withFixture(root => {
      const check: LoadCheck = {
        cli: {
          bin: 'definitely-not-an-agent-cli',
          install: { tool: 'npm', spec: 'nope@1.0.0' },
          isolate: () => ({}),
        },
        load: () => ({ skills: [], mcpUrls: [] }),
      }
      const target = fakeTarget(false, check)
      expect(runTargetLoadCheck(target, root, PROD).status).toBe('skipped')
      const required = runTargetLoadCheck(target, root, PROD, {
        require: true,
      })
      expect(required.status).toBe('failed')
      expect(required.detail).toContain('nope@1.0.0')
    })
  })

  it('runs the CLI isolated and passes when every skill loads', () => {
    withFixture(root => {
      let seenHome = ''
      const target = fakeTarget(
        true,
        nodeCli(session => {
          seenHome = session.home
          const out = session.run([
            '-p',
            'JSON.stringify({home: process.env.FAKE_AGENT_HOME, nested: process.env.CLAUDECODE ?? null})',
          ])
          expect(JSON.parse(out)).toStrictEqual({
            home: session.home,
            nested: null,
          })
          return {
            skills: findSkillNames(path.join(session.dir, 'skills')),
            mcpUrls: [PRODUCTION_MCP_URL],
          }
        }),
      )
      const outcome = runTargetLoadCheck(target, root, PROD, {
        env: { ...process.env, CLAUDECODE: '1' },
      })
      expect(outcome).toMatchObject({ status: 'passed' })
      expect(outcome.detail).toMatch(
        /^loaded \d+ skills and the Socket MCP server$/,
      )
      expect(seenHome).not.toBe('')
      expect(spawnSync('test', ['-e', seenHome]).status).not.toBe(0)
    })
  })

  it('fails with the CLI output when a command exits non-zero', () => {
    withFixture(root => {
      const target = fakeTarget(
        false,
        nodeCli(session => {
          session.run(['-e', 'console.log("bad plugin"); process.exit(3)'])
          return { skills: [], mcpUrls: [] }
        }),
      )
      const outcome = runTargetLoadCheck(target, root, PROD)
      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toContain('exited 3')
      expect(outcome.detail).toContain('bad plugin')
    })
  })

  it('gives the CLI a closed stdin so a prompt cannot wait for input', () => {
    withFixture(root => {
      let out = ''
      const target = fakeTarget(
        false,
        nodeCli(session => {
          out = session.run([
            '-e',
            'process.stdin.on("data", () => {}).on("end", () => console.log("eof"))',
          ])
          return {
            skills: findSkillNames(path.join(session.dir, 'skills')),
            mcpUrls: [],
          }
        }),
      )
      expect(runTargetLoadCheck(target, root, PROD).status).toBe('passed')
      expect(out.trim()).toBe('eof')
    })
  })

  it('returns stderr when a check asks for it', () => {
    withFixture(root => {
      const seen: string[] = []
      const target = fakeTarget(
        false,
        nodeCli(session => {
          const args = ['-e', 'console.log("out"); console.error("err")']
          seen.push(session.run(args), session.run(args, { stream: 'stderr' }))
          return {
            skills: findSkillNames(path.join(session.dir, 'skills')),
            mcpUrls: [],
          }
        }),
      )
      expect(runTargetLoadCheck(target, root, PROD).status).toBe('passed')
      expect(seen).toStrictEqual(['out\n', 'err\n'])
    })
  })

  it('fails when the agent misses a skill', () => {
    withFixture(root => {
      const target = fakeTarget(
        false,
        nodeCli(() => ({ skills: [], mcpUrls: [] })),
      )
      const outcome = runTargetLoadCheck(target, root, PROD)
      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toMatch(/did not load \d+ skill/)
    })
  })

  it('commits the build for agents that install by cloning', () => {
    withFixture(root => {
      let url = ''
      const target = fakeTarget(
        false,
        nodeCli(session => {
          url = session.gitUrl()
          expect(session.gitUrl()).toBe(url)
          return {
            skills: findSkillNames(path.join(session.dir, 'skills')),
            mcpUrls: [],
          }
        }),
      )
      expect(runTargetLoadCheck(target, root, PROD).status).toBe('passed')
      expect(url).toMatch(/^file:\/\//)
      const log = spawnSync('git', ['log', '--format=%s'], {
        cwd: root,
        encoding: 'utf8',
      })
      expect(log.stdout.trim()).toBe('plugin build')
    })
  })
})

describe('formatOutcome', () => {
  it('redacts an override endpoint', () => {
    const line = formatOutcome(
      {
        id: 'x',
        agent: 'X',
        status: 'failed',
        detail: `did not register the Socket MCP server at ${OVERRIDE.mcpUrl}`,
      },
      OVERRIDE,
    )
    expect(line).toBe(
      `FAIL X: did not register the Socket MCP server at <${MCP_URL_ENV}>`,
    )
  })
})

describe('inheritedEnv', () => {
  it('drops nested-agent and git variables', () => {
    expect(
      inheritedEnv({
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        GIT_DIR: '/x',
        HOME: '/h',
        PATH: '/p',
      }),
    ).toStrictEqual({ HOME: '/h', PATH: '/p' })
  })
})

describe('load helpers', () => {
  it('parses JSON after banner lines', () => {
    expect(parseJsonOutput('Welcome!\nnote\n[{"a":1}]\n')).toStrictEqual([
      { a: 1 },
    ])
    expect(
      parseJsonOutput(
        '[ExtensionManager] loading\n[\n  {"name": "x"}\n]\n[done] ok\n',
      ),
    ).toStrictEqual([{ name: 'x' }])
    expect(() => parseJsonOutput('no json here')).toThrow(/Expected JSON/)
    expect(() => parseJsonOutput('[tag] only logs')).toThrow(/Expected JSON/)
  })

  it('collects every URL in nested JSON', () => {
    expect(
      collectUrls({
        a: { url: 'https://x.example/' },
        b: [{ httpUrl: 'http://localhost:1/' }, 'not a url', 3],
      }),
    ).toStrictEqual(['https://x.example/', 'http://localhost:1/'])
  })

  it('finds skill names by frontmatter, bounded by depth', () => {
    withFixture(root => {
      const dir = path.join(root, 'found')
      const write = (rel: string, text: string): void => {
        const full = path.join(dir, rel)
        mkdirSync(path.dirname(full), { recursive: true })
        writeFileSync(full, text)
      }
      write('one/SKILL.md', '---\nname: named-one\ndescription: d\n---\n')
      write('two/SKILL.md', 'no frontmatter\n')
      write('a/b/c/SKILL.md', '---\nname: deep\ndescription: d\n---\n')
      write('node_modules/x/SKILL.md', '---\nname: dep\ndescription: d\n---\n')
      expect(findSkillNames(dir)).toStrictEqual(['deep', 'named-one', 'two'])
      expect(findSkillNames(dir, 1)).toStrictEqual(['named-one', 'two'])
      expect(findSkillNames(path.join(root, 'missing'))).toStrictEqual([])
    })
  })
})

describe('ciMatrix', () => {
  it('lists every target with a load check and a pinned CLI', () => {
    const matrix = ciMatrix()
    expect(matrix.map(m => m.id)).toStrictEqual(
      PLUGIN_TARGETS.filter(t => t.loadCheck).map(t => t.id),
    )
    for (const entry of matrix) {
      if (entry.tool === 'npm') {
        expect(entry.spec, entry.id).toMatch(/^@?[\w./-]+@\d+\.\d+\.\d+$/)
      } else {
        expect(entry.spec, entry.id).toMatch(/@[0-9a-f]{40}$/)
      }
    }
  })

  it('is what the CLI prints for CI', () => {
    const result = spawnSync(process.execPath, [GENERATOR, '--ci-matrix'], {
      encoding: 'utf-8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toStrictEqual(ciMatrix())
  })
})

describe('every load check', () => {
  it.each(PLUGIN_TARGETS.filter(t => t.loadCheck).map(t => [t.id, t] as const))(
    '%s isolates its CLI in the given home',
    (_id, target) => {
      const env = target.loadCheck!.cli.isolate('/fake/home')
      expect(Object.values(env)).toContain('/fake/home')
    },
  )
})
