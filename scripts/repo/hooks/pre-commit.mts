import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { loadLocalEnv } from '../plugins/endpoint.mts'
import { formatScanHits, scanFiles } from '../util/scan.mts'
import { parseStagedBlobPaths } from '../util/staged.mts'

function readStagedFile(file: string): string {
  const result = spawnSync('git', ['cat-file', 'blob', `:${file}`], {
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(
      `could not read the staged copy of ${file}: ${String(result.stderr).trim()}`,
    )
  }
  return result.stdout.toString('utf8')
}

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
})
if (top.status === 0) {
  loadLocalEnv(top.stdout.trim())
}

const staged = spawnSync(
  'git',
  ['diff', '--cached', '--raw', '--no-renames', '--diff-filter=ACM', '-z'],
  { encoding: 'utf8' },
)
if (staged.status !== 0) {
  process.stderr.write(staged.stderr)
  process.exit(1)
}
let hits
try {
  hits = scanFiles(parseStagedBlobPaths(staged.stdout), readStagedFile)
} catch (e) {
  process.stderr.write(`pre-commit: ${(e as Error).message}\n`)
  process.exit(1)
}
if (hits.length > 0) {
  process.stderr.write(
    `pre-commit: staged files contain secrets, personal paths, or non-public Socket hosts:\n${formatScanHits(hits)}\nFix: remove them, then stage again.\n`,
  )
  process.exit(1)
}
