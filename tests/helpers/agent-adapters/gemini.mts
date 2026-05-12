import { execFile } from 'node:child_process'
import type { AgentAdapter, RunPromptOptions } from './types.mts'
import type { AgentResponse } from '../assertions.mts'

export class GeminiAdapter implements AgentAdapter {
  name = 'gemini'

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      execFile('gemini', ['--version'], err => {
        resolve(!err)
      })
    })
  }

  async runPrompt(opts: RunPromptOptions): Promise<AgentResponse> {
    const timeout = opts.timeoutMs ?? 120_000

    return new Promise((resolve, reject) => {
      execFile(
        'gemini',
        ['-p', opts.prompt],
        {
          cwd: opts.workingDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            reject(new Error(`gemini failed: ${err.message}\n${stderr}`))
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
