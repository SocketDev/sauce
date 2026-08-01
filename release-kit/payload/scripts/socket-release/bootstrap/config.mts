/**
 * @file Pure parsing/validation of the consumer's
 *   `.config/socket-release.json`. Hand-rolled — every violation is a
 *   four-ingredient refusal (What / Where / Saw / Fix) with the pinned usage
 *   exit code. The `brew` block is required only when the channels include
 *   `brew`.
 */

import { KitError } from './render.mts'

export const KIT_CHANNELS = ['brew', 'crates', 'github-release', 'npm'] as const
export type Channel = (typeof KIT_CHANNELS)[number]

// The §2.3 byte contract lists channels in this order in every fix line.
const CHANNELS_FIX_ORDER = 'npm, crates, github-release, brew'

export interface BrewConfig {
  assetTemplate: string
  formula: string
  tap: string
  triplets: string[]
}

export interface KitConfig {
  brew?: BrewConfig | undefined
  channels: Channel[]
  npm: {
    access: 'public' | 'restricted' | undefined
    distTag: string
  }
  schemaVersion: 1
}

function refuse(
  what: string,
  filePath: string,
  saw: string,
  fix: string,
  wanted?: string,
): never {
  throw new KitError({ fix, saw, wanted, what, where: filePath }, 2)
}

/**
 * Parse + validate the kit config. Throws the §5 usage refusal (exit 2) on
 * every violation; never returns a partially-valid config.
 */
export function parseKitConfig(raw: string, filePath: string): KitConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    refuse(
      'Kit config is not valid JSON.',
      filePath,
      'unparseable JSON',
      'restore the file from scripts/socket-release/templates/config/socket-release.json.',
      'a schemaVersion-1 socket-release config',
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    refuse(
      'Kit config is not an object.',
      filePath,
      typeof parsed,
      'restore the file from scripts/socket-release/templates/config/socket-release.json.',
      'a JSON object',
    )
  }
  const doc = parsed as Record<string, unknown>
  if (doc['schemaVersion'] !== 1) {
    refuse(
      'Kit config has a foreign schemaVersion.',
      filePath,
      String(doc['schemaVersion']),
      'set "schemaVersion": 1.',
      '1',
    )
  }
  const channels = doc['channels']
  if (!Array.isArray(channels) || channels.length === 0) {
    refuse(
      'Kit config carries no channels.',
      filePath,
      JSON.stringify(channels),
      `set "channels" to a non-empty subset of ${CHANNELS_FIX_ORDER}.`,
      'a non-empty channels array',
    )
  }
  for (let i = 0, { length } = channels; i < length; i += 1) {
    const c: unknown = channels[i]
    if (
      typeof c !== 'string' ||
      !(KIT_CHANNELS as readonly string[]).includes(c)
    ) {
      refuse(
        'Kit config names an unknown channel.',
        filePath,
        String(c),
        `use one of ${CHANNELS_FIX_ORDER}.`,
        KIT_CHANNELS.join(' | '),
      )
    }
  }
  const typedChannels = [...(channels as Channel[])]
  const npmBlock = doc['npm']
  const npm =
    typeof npmBlock === 'object' && npmBlock !== null
      ? (npmBlock as Record<string, unknown>)
      : {}
  const access = npm['access']
  if (access !== undefined && access !== 'public' && access !== 'restricted') {
    refuse(
      'Kit config npm.access is not a valid access level.',
      filePath,
      String(access),
      'set "npm": { "access": "restricted" } (or "public").',
      'public | restricted',
    )
  }
  const distTag = npm['distTag'] ?? 'latest'
  if (typeof distTag !== 'string' || distTag === '') {
    refuse(
      'Kit config npm.distTag is not a dist-tag.',
      filePath,
      String(distTag),
      'set "npm": { "distTag": "latest" }.',
      'a non-empty string',
    )
  }
  let brew: BrewConfig | undefined
  if (typedChannels.includes('brew')) {
    const brewBlock = doc['brew']
    if (typeof brewBlock !== 'object' || brewBlock === null) {
      refuse(
        'Kit config enables the brew channel without a brew block.',
        filePath,
        String(brewBlock),
        'add "brew": { "tap", "formula", "assetTemplate", "triplets" } — see templates/config/socket-release.json.',
        'a brew object',
      )
    }
    const b = brewBlock as Record<string, unknown>
    const tap = b['tap']
    const formula = b['formula']
    const assetTemplate = b['assetTemplate']
    const triplets = b['triplets']
    if (typeof tap !== 'string' || tap === '') {
      refuse(
        'Kit config brew.tap is missing.',
        filePath,
        String(tap),
        'set "brew": { "tap": "SocketDev/socket" }.',
        'an <owner>/<name> tap slug',
      )
    }
    if (typeof formula !== 'string') {
      refuse(
        'Kit config brew.formula is not a string.',
        filePath,
        String(formula),
        'set "brew": { "formula": "<name>" } (empty means the package basename).',
        'a string',
      )
    }
    if (typeof assetTemplate !== 'string' || assetTemplate === '') {
      refuse(
        'Kit config brew.assetTemplate is missing.',
        filePath,
        String(assetTemplate),
        'set "brew": { "assetTemplate": "<name>-<triplet>.tar.gz" }.',
        'a template naming <name>/<triplet>/<version> placeholders',
      )
    }
    if (
      !Array.isArray(triplets) ||
      triplets.length === 0 ||
      !triplets.every(t => typeof t === 'string')
    ) {
      refuse(
        'Kit config brew.triplets is not a non-empty string array.',
        filePath,
        JSON.stringify(triplets),
        'set "brew": { "triplets": ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] }.',
        'a non-empty string array',
      )
    }
    brew = {
      assetTemplate,
      formula,
      tap,
      triplets: [...(triplets as string[])],
    }
  }
  return {
    brew,
    channels: typedChannels,
    npm: { access: access as 'public' | 'restricted' | undefined, distTag },
    schemaVersion: 1,
  }
}
