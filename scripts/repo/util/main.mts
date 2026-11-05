import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export interface ScriptMeta {
  readonly describe: string
  readonly help?: string | undefined
  readonly json?: 'native' | 'result' | undefined
}

export type MainFn = () => unknown

export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry)
  } catch {
    return false
  }
}

export function runMain(main: MainFn, meta?: ScriptMeta | undefined): void {
  void runMainAsync(main, meta)
}

export async function runMainAsync(
  main: MainFn,
  meta?: ScriptMeta | undefined,
): Promise<void> {
  const args = process.argv.slice(2)
  if (meta && (args.includes('--help') || args.includes('--describe'))) {
    process.stdout.write(
      `${args.includes('--describe') ? meta.describe : (meta.help ?? meta.describe)}\n`,
    )
    return
  }
  try {
    const result = await main()
    if (typeof result === 'number') {
      process.exitCode = result
    } else if (process.exitCode === undefined) {
      process.exitCode = 0
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
