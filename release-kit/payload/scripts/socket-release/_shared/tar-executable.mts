import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib/env/rewire'

import { socketReleaseSystemTarPath } from '../paths.mts'

/**
 * Select Windows' native bsdtar; use the PATH-provided tar on POSIX.
 */
export function tarExecutable(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = getEnvValue('SystemRoot'),
): string {
  return platform === 'win32'
    ? socketReleaseSystemTarPath(systemRoot ?? 'C:\\Windows')
    : 'tar'
}
