import { spawn } from 'node:child_process'
import type { AgentAdapter, RunPromptOptions } from './types.js'
import type { AgentResponse } from '../assertions.js'

/** Environment variables that must be removed to avoid nested-session detection. */
const CLAUDE_ENV_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'NODE_PATH']

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of CLAUDE_ENV_VARS) {
    delete env[key]
  }
  // Ensure the Socket CLI can authenticate using whichever key is available
  if (!env.SOCKET_CLI_API_TOKEN && env.SOCKET_SECURITY_API_KEY) {
    env.SOCKET_CLI_API_TOKEN = env.SOCKET_SECURITY_API_KEY
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
      proc.on('close', code => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async runPrompt(opts: RunPromptOptions): Promise<AgentResponse> {
    const timeout = opts.timeoutMs ?? 120_000

    return new Promise((resolve, reject) => {
      const proc = spawn(
        'claude',
        [
          '--print',
          opts.prompt,
          '--output-format',
          'json',
          '--max-turns',
          '10',
        ],
        {
          cwd: opts.workingDir,
          env: cleanEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => {
        stdout += d
      })
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d
      })

      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(
          new Error(
            `claude --print timed out after ${timeout}ms\nstderr: ${stderr.slice(0, 500)}`,
          ),
        )
      }, timeout)

      proc.on('close', code => {
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
          const parsed = JSON.parse(stdout) as {
            result?: string
            subtype?: string
            tool_calls?: Array<{
              name: string
              args?: Record<string, unknown>
            }>
          }

          // When result is present, use it. When the agent hit max turns
          // (subtype === "error_max_turns") result may be absent — return
          // an empty output so the test can evaluate what happened.
          const output = parsed.result || ''

          resolve({
            output,
            toolCalls: parsed.tool_calls,
            exitCode: code ?? 0,
          })
        } catch {
          resolve({
            output: stdout || stderr,
            exitCode: code ?? 0,
          })
        }
      })

      proc.on('error', e => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }
}
