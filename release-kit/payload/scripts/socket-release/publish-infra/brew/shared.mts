/**
 * @file Pure brew-tier helpers: tap-slug normalization, formula path/class
 *   naming, asset-name templating, and the checksums.txt parser. The sha256
 *   AUTHORITY is the release's own `checksums.txt` — the brew tools never
 *   hash assets themselves — so this parser accepts BOTH grammars that
 *   manifest appears in: plain `<sha256-hex>  <name>` lines (shasum, the
 *   github-release producer) and the kit release tail's prefixed
 *   `sha256: <hex>  <name>` lines. No I/O anywhere in this module.
 */

/**
 * Normalize a tap reference: `SocketDev/socket` and
 * `SocketDev/homebrew-socket` both mean the repo
 * `SocketDev/homebrew-socket` with brew slug `SocketDev/socket`.
 */
export function normalizeTap(input: string): { repo: string; slug: string } {
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(input.trim())
  if (!m) {
    throw new Error(
      [
        `Unrecognized tap "${input}".`,
        '  Where: .config/socket-release.json brew.tap (or --tap)',
        `  Saw: ${input}`,
        '  Wanted: <owner>/<name> in either form',
        '  Fix: use the brew slug form (SocketDev/socket) or the repo form (SocketDev/homebrew-socket).',
      ].join('\n'),
    )
  }
  const owner = m[1]!
  const name = m[2]!
  const bare = name.startsWith('homebrew-')
    ? name.slice('homebrew-'.length)
    : name
  return { repo: `${owner}/homebrew-${bare}`, slug: `${owner}/${bare}` }
}

/**
 * The unsharded formula path inside the tap repo.
 */
export function formulaPath(name: string): string {
  return `Formula/${name}.rb`
}

/**
 * The Ruby class name Homebrew derives from a formula name: split on
 * `[-_.]`, capitalize each token, join. A digit-leading token throws —
 * Homebrew class names cannot start with a digit.
 */
export function formulaClassName(name: string): string {
  const tokens = name.split(/[-_.]/).filter(t => t.length > 0)
  if (tokens.length === 0) {
    throw new Error(
      `formula name "${name}" has no tokens to build a class name from`,
    )
  }
  if (/^\d/.test(tokens[0]!)) {
    throw new Error('Homebrew class names cannot start with a digit')
  }
  return tokens.map(t => `${t[0]!.toUpperCase()}${t.slice(1)}`).join('')
}

/**
 * Expand the asset-name template for every triplet. Placeholders: `<name>`,
 * `<triplet>`, `<version>`.
 */
export function assetNamesForTriplets(
  name: string,
  version: string,
  template: string,
  triplets: readonly string[],
): Array<{ asset: string; triplet: string }> {
  return triplets.map(triplet => ({
    asset: template
      .replaceAll('<name>', name)
      .replaceAll('<triplet>', triplet)
      .replaceAll('<version>', version),
    triplet,
  }))
}

const PLAIN_LINE = /^([0-9a-f]{64})\s+(\S+)$/
const PREFIXED_LINE = /^sha256: ([0-9a-f]{64})\s+(\S+)$/

/**
 * Parse a release `checksums.txt` into filename → sha256-hex. Accepts BOTH
 * grammars (plain shasum lines and the kit's `sha256:`-prefixed lines);
 * every other line (sha1:/sha512-base64:/blank/comment) is ignored. A
 * duplicate filename with a DIFFERING hex throws — a self-contradictory
 * manifest must never pick a winner silently.
 */
export function parseChecksumsTxt(text: string): Map<string, string> {
  const map = new Map<string, string>()
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    const m = PLAIN_LINE.exec(line) ?? PREFIXED_LINE.exec(line)
    if (!m) {
      continue
    }
    const hex = m[1]!
    const file = m[2]!
    const existing = map.get(file)
    if (existing !== undefined && existing !== hex) {
      throw new Error(
        `checksums.txt names ${file} twice with differing sha256 values (${existing} vs ${hex}) — refusing a self-contradictory manifest.`,
      )
    }
    map.set(file, hex)
  }
  return map
}
