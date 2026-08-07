/*
 * @file Release-tier gate: the release-kit tree — payload engine, installer,
 *   gen-manifest — typechecks under the fleet compiler settings. The fleet
 *   `pnpm run type` scopes to `scripts/**`, so without this the payload's
 *   types would only ever be checked by hand. Held to the release tier
 *   (pre-push / CI, where check.mts sets FLEET_CHECK_RELEASE=1) because a
 *   full tsc program load is an inner-loop long pole.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { spawnSync } from '@socketsecurity/lib/process/spawn/child'
import { isMainModule } from '../../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

function main(): void {
  if (process.env['FLEET_CHECK_RELEASE'] !== '1') {
    logger.log(
      'release-kit typecheck held to the release tier (pre-push / CI / --release).',
    )
    return
  }
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--noEmit',
      '-p',
      '.config/repo/tsconfig.release-kit.json',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (result.status !== 0) {
    logger.fail(
      'release-kit typecheck failed — run `node node_modules/typescript/bin/tsc --noEmit -p .config/repo/tsconfig.release-kit.json`.',
    )
    process.exitCode = 1
    return
  }
  logger.success('release-kit typechecks clean.')
}

if (isMainModule(import.meta.url)) {
  main()
}
