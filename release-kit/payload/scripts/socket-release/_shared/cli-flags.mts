/**
 * @file Unknown-flag rejection for the kit's CLIs. @socketsecurity/lib
 *   parseArgs does not throw on unknown options even under strict mode — an
 *   unknown flag lands in `values` as a boolean rather than an error — so a
 *   typo like `--dryrun` for `--dry-run` would otherwise slip through and a
 *   registry-writing entry would run for real instead of previewing. Each
 *   entry diffs the parsed keys against its declared options and exits 2 (the
 *   usage-error code) on any unknown flag.
 */

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/**
 * The parsed-value keys that name no declared option, in encounter order.
 * Empty means every flag was recognized. Both the declared spelling and its
 * camelCase alias count as known, because @socketsecurity/lib parseArgs mirrors
 * every `--dash-flag` into a `dashFlag` value key.
 */
export function unknownFlags(
  values: Record<string, unknown>,
  declared: readonly string[],
): string[] {
  const known = new Set<string>()
  for (let i = 0, { length } = declared; i < length; i += 1) {
    const name = declared[i]!
    known.add(name)
    known.add(camelCase(name))
  }
  return Object.keys(values).filter(name => !known.has(name))
}

/**
 * The one-line refusal for unknown flags, listing each with its leading dashes.
 */
export function unknownFlagsMessage(unknown: readonly string[]): string {
  const flags = unknown
    .map(name => (name.length === 1 ? `-${name}` : `--${name}`))
    .join(', ')
  return `Unknown flag${unknown.length === 1 ? '' : 's'}: ${flags}`
}
