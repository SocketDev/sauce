// Specs for choosing the Socket deployment a local test run talks to, and for
// keeping a non-production deployment out of tracked files and output.

import { describe, expect, it } from 'vitest'

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

import {
  API_URL_ENV,
  describeEndpoints,
  loadLocalEnv,
  MCP_URL_ENV,
  parseEndpoint,
  privateHosts,
  PRODUCTION_API_URL,
  PRODUCTION_MCP_URL,
  PUBLIC_SOCKET_HOSTS,
  redactEndpoints,
  resolveEndpoints,
} from '../../../../scripts/repo/plugins/endpoint.mts'
import {
  buildLocalPlugin,
  listShippedFiles,
  pointAtEndpoints,
} from '../../../../scripts/repo/plugins/local-build.mts'
import { scanRules, scanText } from '../../../../scripts/repo/util/scan.mts'
import { isolateGitEnv } from '../../util/git-env.mts'
import { withFixture, writeFile } from './fixture.mts'

isolateGitEnv()

const OVERRIDE = {
  [MCP_URL_ENV]: 'https://mcp.example-deploy.example.test',
  [API_URL_ENV]: 'https://api.example-deploy.example.test/base',
}

describe('parseEndpoint', () => {
  it.each([
    ['https://a.example.test', 'https://a.example.test/'],
    ['https://a.example.test/x', 'https://a.example.test/x/'],
    ['http://localhost:3000', 'http://localhost:3000/'],
    ['http://127.0.0.1:8080/mcp/', 'http://127.0.0.1:8080/mcp/'],
    ['http://[::1]:9/', 'http://[::1]:9/'],
    ['http://app.localhost', 'http://app.localhost/'],
  ])('accepts %s', (value, expected) => {
    expect(parseEndpoint('X', value)).toBe(expected)
  })

  it.each([
    ['not a url', /not a valid URL/],
    ['http://a.example.test', /must use https/],
    ['ftp://a.example.test', /must use https/],
    ['https://user:pw@a.example.test', /credentials/],
    ['https://a.example.test/?token=1', /query string/],
    ['https://a.example.test/#x', /fragment/],
  ])('rejects %s without echoing it', (value, message) => {
    let error: Error | undefined
    try {
      parseEndpoint('X', value)
    } catch (e) {
      error = e as Error
    }
    expect(error?.message).toMatch(message)
    expect(error?.message).not.toContain(value)
  })
})

describe('resolveEndpoints', () => {
  it('defaults to production', () => {
    expect(resolveEndpoints({})).toStrictEqual({
      mcpUrl: PRODUCTION_MCP_URL,
      apiUrl: PRODUCTION_API_URL,
      isProduction: true,
    })
  })

  it('treats empty and blank values as unset', () => {
    expect(
      resolveEndpoints({ [MCP_URL_ENV]: '', [API_URL_ENV]: '  ' }).isProduction,
    ).toBe(true)
  })

  it('reads both overrides', () => {
    expect(resolveEndpoints(OVERRIDE)).toStrictEqual({
      mcpUrl: 'https://mcp.example-deploy.example.test/',
      apiUrl: 'https://api.example-deploy.example.test/base/',
      isProduction: false,
    })
  })

  it('is not production when only one is overridden', () => {
    expect(
      resolveEndpoints({ [API_URL_ENV]: 'http://localhost:1/' }).isProduction,
    ).toBe(false)
  })

  it('accepts production given explicitly', () => {
    expect(
      resolveEndpoints({
        [MCP_URL_ENV]: 'https://mcp.socket.dev',
        [API_URL_ENV]: 'https://api.socket.dev/',
      }).isProduction,
    ).toBe(true)
  })
})

describe('describeEndpoints', () => {
  it('names production and never names an override', () => {
    expect(describeEndpoints(resolveEndpoints({}))).toBe('production')
    const label = describeEndpoints(resolveEndpoints(OVERRIDE))
    expect(label).toContain(MCP_URL_ENV)
    expect(label).not.toContain('example-deploy')
  })
})

describe('privateHosts', () => {
  it('lists override hosts but not public or loopback ones', () => {
    expect(privateHosts(resolveEndpoints({}))).toStrictEqual([])
    expect(
      privateHosts(
        resolveEndpoints({ [MCP_URL_ENV]: 'http://localhost:3000' }),
      ),
    ).toStrictEqual([])
    expect(privateHosts(resolveEndpoints(OVERRIDE))).toStrictEqual([
      'api.example-deploy.example.test',
      'mcp.example-deploy.example.test',
    ])
  })
})

describe('redactEndpoints', () => {
  it('replaces override URLs and hosts with the variable name', () => {
    const endpoints = resolveEndpoints(OVERRIDE)
    const text = `GET ${endpoints.mcpUrl}x failed; host api.example-deploy.example.test down`
    expect(redactEndpoints(text, endpoints)).toBe(
      `GET <${MCP_URL_ENV}>x failed; host <${API_URL_ENV}> down`,
    )
  })

  it('leaves production untouched', () => {
    const text = `see ${PRODUCTION_MCP_URL}`
    expect(redactEndpoints(text, resolveEndpoints({}))).toBe(text)
  })
})

describe('loadLocalEnv', () => {
  it('loads .env.local without overriding set variables', () => {
    withFixture(root => {
      expect(loadLocalEnv(root)).toBe(false)
      const key = 'SAUCE_TEST_LOCAL_ENV_VALUE'
      const kept = 'SAUCE_TEST_LOCAL_ENV_KEPT'
      process.env[kept] = 'from-env'
      try {
        writeFile(root, '.env.local', `${key}=from-file\n${kept}=from-file\n`)
        expect(loadLocalEnv(root)).toBe(true)
        expect(process.env[key]).toBe('from-file')
        expect(process.env[kept]).toBe('from-env')
      } finally {
        delete process.env[key]
        delete process.env[kept]
      }
    })
  })
})

describe('content scan', () => {
  it.each(PUBLIC_SOCKET_HOSTS)('allows the public host %s', host => {
    expect(scanText('a.md', `see https://${host}/x`)).toStrictEqual([])
  })

  const SOCKET_DOMAIN = ['socket', 'dev'].join('.')
  it.each([
    `https://internal.${SOCKET_DOMAIN}/`,
    `https://docs.${SOCKET_DOMAIN} and https://other.${SOCKET_DOMAIN}`,
    `a.b.${SOCKET_DOMAIN}`,
  ])('flags a non-public socket.dev host in %s', line => {
    expect(scanText('a.md', line).map(h => h.rule)).toStrictEqual([
      'non-public-socket-host',
    ])
  })

  it('does not flag an email address at socket.dev', () => {
    expect(scanText('a.md', 'mail someone@socket.dev')).toStrictEqual([])
  })

  it('flags an override host configured in the environment', () => {
    const rules = scanRules(OVERRIDE)
    expect(
      scanText(
        'a.md',
        'curl https://api.example-deploy.example.test/v0',
        rules,
      ).map(h => h.rule),
    ).toStrictEqual(['endpoint-override'])
    expect(
      scanText('a.md', 'xapi.example-deploy.example.testy', rules),
    ).toStrictEqual([])
  })

  it('adds no override rule for production, loopback, or a malformed value', () => {
    const base = scanRules({}).length
    expect(scanRules({ [MCP_URL_ENV]: 'http://localhost:1' })).toHaveLength(
      base,
    )
    expect(scanRules({ [MCP_URL_ENV]: 'not a url' })).toHaveLength(base)
  })
})

describe('pointAtEndpoints', () => {
  it('rewrites both production URLs, keeping paths', () => {
    const endpoints = resolveEndpoints(OVERRIDE)
    expect(
      pointAtEndpoints(
        `url ${PRODUCTION_MCP_URL}\ncurl ${PRODUCTION_API_URL}v0/orgs\n`,
        endpoints,
      ),
    ).toBe(
      'url https://mcp.example-deploy.example.test/\n' +
        'curl https://api.example-deploy.example.test/base/v0/orgs\n',
    )
  })
})

describe('buildLocalPlugin', () => {
  function initGit(root: string): void {
    const result = spawnSync('git', ['init', '-q'], { cwd: root })
    expect(result.status).toBe(0)
  }

  it('copies only shipped files and rewrites endpoints in the copy', () => {
    withFixture(root => {
      initGit(root)
      writeFile(root, 'skills/alpha/ref.md', `Use ${PRODUCTION_MCP_URL}\n`)
      writeFile(root, 'scripts/internal.mts', 'internal\n')
      writeFile(root, '.gitignore', 'tmp/\n')
      const shipped = listShippedFiles(root)
      expect(shipped).toContain('skills/alpha/ref.md')
      expect(shipped).not.toContain('scripts/internal.mts')

      const build = buildLocalPlugin(
        root,
        'tmp/plugins/x',
        resolveEndpoints(OVERRIDE),
      )
      expect(build.files).toBe(shipped.length)
      expect(build.rewritten).toBe(1)
      expect(
        readFileSync(path.join(build.dir, 'skills/alpha/ref.md'), 'utf-8'),
      ).toBe('Use https://mcp.example-deploy.example.test/\n')
      expect(existsSync(path.join(build.dir, 'scripts'))).toBe(false)
      expect(
        readFileSync(path.join(root, 'skills/alpha/ref.md'), 'utf-8'),
      ).toBe(`Use ${PRODUCTION_MCP_URL}\n`)
    })
  })

  it('copies production byte for byte and keeps symlinks', () => {
    withFixture(root => {
      initGit(root)
      mkdirSync(path.join(root, '.opencode'), { recursive: true })
      spawnSync('ln', ['-s', '../skills', '.opencode/skills'], { cwd: root })
      const build = buildLocalPlugin(root, 'tmp/p', resolveEndpoints({}))
      expect(build.rewritten).toBe(0)
      expect(readlinkSync(path.join(build.dir, '.opencode/skills'))).toBe(
        '../skills',
      )
    })
  })

  it('clears a previous build', () => {
    withFixture(root => {
      initGit(root)
      writeFile(root, 'tmp/p/stale.txt', 'old\n')
      const build = buildLocalPlugin(root, 'tmp/p', resolveEndpoints({}))
      expect(existsSync(path.join(build.dir, 'stale.txt'))).toBe(false)
    })
  })

  it.each(['.', 'out', '../tmp/x', '/tmp/x'])(
    'refuses to write outside a tmp/ directory in the repository (%s)',
    out => {
      withFixture(root => {
        expect(() => buildLocalPlugin(root, out, resolveEndpoints({}))).toThrow(
          /tmp\/ directory inside the repository/,
        )
      })
    },
  )
})
