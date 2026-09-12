import process from 'node:process'

import { socketReleaseSystemTarPath } from '../paths.mts'

/**
 * Select Windows' native bsdtar; use the PATH-provided tar on POSIX.
 */
export function tarExecutable(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env['SystemRoot'],
): string {
  return platform === 'win32'
    ? socketReleaseSystemTarPath(systemRoot ?? 'C:\\Windows')
    : 'tar'
}
