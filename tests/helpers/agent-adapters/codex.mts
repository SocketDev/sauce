import { execFile } from 'node:child_process'
import type { AgentAdapter, RunPromptOptions } from './types.mts'
import type { AgentResponse } from '../assertions.mts'

export class CodexAdapter implements AgentAdapter {
  name = 'codex'

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      execFile('codex', ['--version'], err => {
        resolve(!err)
      })
    })
  }

  async runPrompt(options: RunPromptOptions): Promise<AgentResponse> {
    const opts = { __proto__: null, ...options } as typeof options
    const timeout = opts.timeoutMs ?? 120_000

    return new Promise((resolve, reject) => {
      execFile(
        'codex',
        ['--quiet', '--approval-mode', 'full-auto', opts.prompt],
        {
          cwd: opts.workingDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            reject(new Error(`codex failed: ${err.message}\n${stderr}`))
            return
          }

          const errCode = err?.code
          resolve({
            output: stdout || stderr,
            exitCode: typeof errCode === 'number' ? errCode : 0,
          })
        },
      )
    })
  }
}
