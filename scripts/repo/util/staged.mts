const GITLINK_MODE = '160000'

/**
 * Paths with a readable staged blob, from `git diff --cached --raw -z
 * --no-renames` output. Gitlinks (submodules) carry no blob, so they are
 * left out.
 */
export function parseStagedBlobPaths(rawZ: string): string[] {
  const fields = rawZ.split('\0')
  const paths: string[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const header = fields[index]!
    const file = fields[index + 1]!
    if (!header.startsWith(':') || !file) {
      continue
    }
    const newMode = header.slice(1).split(' ')[1]
    if (newMode !== GITLINK_MODE) {
      paths.push(file)
    }
  }
  return paths
}
