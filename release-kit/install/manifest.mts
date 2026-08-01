/**
 * @file PURE manifest logic for the release kit: the channel → file-set
 *   mapping (data, not fs walks), manifest parsing/validation, and channel
 *   filtering. The payload's `kit-manifest.json` pins the post-format bytes
 *   of every payload file (R11); `gen-manifest.mts` generates it and the
 *   installer consumes it. `common` is always implied — it is everything no
 *   optional channel claims.
 */

export const KIT_CHANNELS = ['brew', 'crates', 'github-release', 'npm'] as const
export type KitChannel = (typeof KIT_CHANNELS)[number]
export type ManifestChannel = KitChannel | 'common'

export const MANIFEST_FILENAME = 'kit-manifest.json'
export const KIT_VERSION = '0.1.0'

export interface ManifestEntry {
  channels: ManifestChannel[]
  path: string
  sha256: string
}

export interface KitManifest {
  files: ManifestEntry[]
  kitVersion: string
  schemaVersion: 1
}

/**
 * The channel(s) a payload-relative path belongs to. Everything unclaimed is
 * `common` (bootstrap, shared libs, constants, config templates, the
 * manifest itself travels implicitly).
 */
export function channelsForPath(relPath: string): ManifestChannel[] {
  const p = relPath.replaceAll('\\', '/')
  if (
    p.startsWith('publish-infra/npm/') ||
    p === 'npm-publish.mts' ||
    p === 'npm-web-auth.mts' ||
    p === 'publish-infra/socket-oauth.mts' ||
    p === 'templates/workflows/npm-publish.yml'
  ) {
    return ['npm']
  }
  if (
    p.startsWith('publish-infra/cargo/') ||
    p === 'cargo-publish.mts' ||
    p === 'templates/workflows/cargo-publish.yml'
  ) {
    return ['crates']
  }
  if (
    p === 'create-release.mts' ||
    p === 'github-release.mts' ||
    p === 'registry-liveness-gate.mjs' ||
    p === 'registry-liveness-gate.d.mts' ||
    p.startsWith('lib/release-checksums/') ||
    p === 'templates/workflows/github-release.yml'
  ) {
    return ['github-release']
  }
  if (
    p.startsWith('publish-infra/brew/') ||
    p === 'brew-publish.mts' ||
    p === 'lib/commit-via-github-api.mts' ||
    p === 'templates/workflows/brew-publish.yml' ||
    p.startsWith('templates/actions/socket-release-app-token/') ||
    p === 'util/pack-app-triplets.mts'
  ) {
    return ['brew']
  }
  return ['common']
}

/**
 * The entries a channel selection installs: the named channels plus the
 * always-implied `common`.
 */
export function filterByChannels(
  entries: readonly ManifestEntry[],
  channels: readonly KitChannel[],
): ManifestEntry[] {
  const selected = new Set<ManifestChannel>(['common', ...channels])
  return entries.filter(e => e.channels.some(c => selected.has(c)))
}

/**
 * Parse a `--channels` flag value. Throws on unknown names with the exact
 * valid set.
 */
export function parseChannelsFlag(value: string): KitChannel[] {
  const parts = value
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0 && p !== 'common')
  const channels = new Set<KitChannel>()
  for (let i = 0, { length } = parts; i < length; i += 1) {
    const p = parts[i]!
    const known = KIT_CHANNELS.find(c => c === p)
    if (!known) {
      throw new Error(
        `unknown channel "${p}" — valid channels: ${KIT_CHANNELS.join(', ')} (common is always implied)`,
      )
    }
    channels.add(known)
  }
  if (channels.size === 0) {
    throw new Error(
      `no channels selected — pick from ${KIT_CHANNELS.join(', ')}`,
    )
  }
  return [...channels]
}

/**
 * Parse + validate a kit manifest. Throws with the four ingredients on any
 * violation — a manifest that cannot be trusted must never drive copies.
 */
export function parseKitManifest(raw: string, where: string): KitManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      [
        'Kit manifest is not valid JSON.',
        `  Where: ${where}`,
        '  Saw: unparseable JSON',
        '  Wanted: a schemaVersion-1 kit manifest',
        '  Fix: node release-kit/gen-manifest.mts',
      ].join('\n'),
    )
  }
  const doc =
    parsed && typeof parsed === 'object'
      ? (parsed as {
          files?: unknown | undefined
          kitVersion?: unknown | undefined
          schemaVersion?: unknown | undefined
        })
      : undefined
  if (!doc || doc.schemaVersion !== 1) {
    throw new Error(
      [
        'Kit manifest has a foreign schema.',
        `  Where: ${where}`,
        `  Saw: schemaVersion ${String(doc ? doc.schemaVersion : parsed)}`,
        '  Wanted: schemaVersion 1',
        '  Fix: node release-kit/gen-manifest.mts',
      ].join('\n'),
    )
  }
  if (!Array.isArray(doc.files)) {
    throw new Error(
      [
        'Kit manifest carries no files array.',
        `  Where: ${where}`,
        `  Saw: ${typeof doc.files}`,
        '  Wanted: files: [{path, sha256, channels}]',
        '  Fix: node release-kit/gen-manifest.mts',
      ].join('\n'),
    )
  }
  const files: ManifestEntry[] = []
  for (let i = 0, { length } = doc.files; i < length; i += 1) {
    const entry: unknown = doc.files[i]
    const f =
      entry && typeof entry === 'object'
        ? (entry as {
            channels?: unknown | undefined
            path?: unknown | undefined
            sha256?: unknown | undefined
          })
        : undefined
    if (
      !f ||
      typeof f.path !== 'string' ||
      typeof f.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(f.sha256) ||
      !Array.isArray(f.channels) ||
      f.channels.length === 0 ||
      !f.channels.every(
        (c: unknown) =>
          typeof c === 'string' &&
          (c === 'common' || (KIT_CHANNELS as readonly string[]).includes(c)),
      )
    ) {
      throw new Error(
        [
          `Kit manifest files[${i}] is malformed.`,
          `  Where: ${where}`,
          `  Saw: ${JSON.stringify(f)}`,
          '  Wanted: {path, sha256 (64 hex), channels (non-empty)}',
          '  Fix: node release-kit/gen-manifest.mts',
        ].join('\n'),
      )
    }
    files.push({
      channels: f.channels.filter(
        (c: unknown): c is ManifestChannel =>
          typeof c === 'string' &&
          (c === 'common' || (KIT_CHANNELS as readonly string[]).includes(c)),
      ),
      path: f.path,
      sha256: f.sha256,
    })
  }
  return {
    files,
    kitVersion:
      typeof doc.kitVersion === 'string' ? doc.kitVersion : KIT_VERSION,
    schemaVersion: 1,
  }
}
