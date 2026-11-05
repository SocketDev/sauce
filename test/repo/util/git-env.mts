import process from 'node:process'

/**
 * Git variables that point a `git` child at a specific repository. A test that
 * spawns `git` against a temp directory must not inherit them, or the child
 * writes to the live checkout instead.
 */
export const GIT_CONTEXT_VARS: readonly string[] = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
]

/**
 * Remove the inherited git context variables and point the global and system
 * git config at `/dev/null`, so `git` children see only the temp repo's own
 * config.
 */
export function isolateGitEnv(): void {
  for (const name of GIT_CONTEXT_VARS) {
    delete process.env[name]
  }
  process.env['GIT_CONFIG_GLOBAL'] = '/dev/null'
  process.env['GIT_CONFIG_SYSTEM'] = '/dev/null'
}
