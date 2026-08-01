import { spawn } from '@socketsecurity/lib/process/spawn/child'
import type { AgentAdapter, RunPromptConfig } from './types.mts'
import type { AgentResponse } from '../assertions.mts'

/**
 * Environment variables that must be removed to avoid nested-session detection.
 */
const CLAUDE_ENV_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'NODE_PATH']

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (let i = 0, { length } = CLAUDE_ENV_VARS; i < length; i += 1) {
    const key = CLAUDE_ENV_VARS[i]!
    delete env[key]
  }
  // Ensure the Socket CLI can authenticate using whichever key is available
  if (!env['SOCKET_CLI_API_TOKEN'] && env['SOCKET_API_TOKEN']) {
    env['SOCKET_CLI_API_TOKEN'] = env['SOCKET_API_TOKEN']
  }
  return env
}

export class ClaudeCodeAdapter implements AgentAdapter {
  name = 'claude-code'

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn('claude', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: cleanEnv(),
      })
      proc.process.on('close', (code: number | null) => resolve(code === 0))
      proc.process.on('error', () => resolve(false))
    })
  }

  async runPrompt(config: RunPromptConfig): Promise<AgentResponse> {
    const cfg = { __proto__: null, ...config } as typeof config
    const timeout = cfg.timeoutMs ?? 120_000

    return new Promise((resolve, reject) => {
      const proc = spawn(
        'claude',
        // Multi-phase skill prompts (scan → classify → report) legitimately
        // burn 15-25 turns; at 10 the CLI stops with subtype
        // "error_max_turns", an EMPTY result and exit code 1, which scored
        // 0% in CI. 30 bounds runaway sessions while timeoutMs bounds cost.
        ['--print', cfg.prompt, '--output-format', 'json', '--max-turns', '30'],
        {
          cwd: cfg.workingDir,
          env: cleanEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      // `spawn` is promise-spawn shaped: the returned handle is itself a
      // promise that REJECTS on any non-zero exit (e.g. max-turns exits 1
      // with a JSON payload on stdout). All outcome handling lives on the
      // `close` listener below, so swallow the duplicate rejection channel —
      // otherwise it escapes as a vitest unhandled-rejection error.
      void proc.catch(() => {})

      let stdout = ''
      let stderr = ''
      proc.process.stdout?.on('data', (d: Buffer) => {
        stdout += d
      })
      proc.process.stderr?.on('data', (d: Buffer) => {
        stderr += d
      })

      const timer = setTimeout(() => {
        proc.process.kill('SIGTERM')
        reject(
          new Error(
            `claude --print timed out after ${timeout}ms\nstderr: ${stderr.slice(0, 500)}`,
          ),
        )
      }, timeout)

      proc.process.on('close', (code: number | null) => {
        clearTimeout(timer)

        if (code !== 0 && !stdout) {
          reject(
            new Error(
              `claude --print failed (exit ${code}): ${stderr.slice(0, 500)}`,
            ),
          )
          return
        }

        try {
          // Claude CLI owns the --print --output-format json payload shape;
          // both fields are re-guarded below before use.
          // eslint-disable-next-line typescript/no-unsafe-type-assertion -- see above
          const parsed = JSON.parse(stdout) as {
            result?: string | undefined
            subtype?: string | undefined
            tool_calls?:
              | Array<{
                  name: string
                  args?: Record<string, unknown> | undefined
                }>
              | undefined
          }

          // When result is present, use it. When the agent hit max turns
          // (subtype === "error_max_turns") result may be absent — return
          // an empty output so the test can evaluate what happened.
          const output = parsed.result || ''

          resolve({
            output,
            ...(parsed.tool_calls !== undefined && {
              toolCalls: parsed.tool_calls,
            }),
            exitCode: code ?? 0,
          })
        } catch {
          resolve({
            output: stdout || stderr,
            exitCode: code ?? 0,
          })
        }
      })

      proc.process.on('error', (e: Error) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }
}
