/*
 * Release-checksum core: format primitives + embedded-checksum loader + verify.
 *
 * This file is the **shared core** used by every fleet repo that publishes
 * artifacts whose integrity is gated by a checksum. It contains no network
 * code and no producer code — see `consumer.mts` for the network fetch path,
 * and `producer.mts` for the writer side.
 *
 * Two checksum formats meet here, deliberately kept apart:
 *
 * - `release-assets.json` pins (`ToolConfig.checksums`) are SRI integrity strings
 *   (`sha256-<base64>`, forward-compatible with sha384/sha512).
 * - `checksums.txt`, the release asset every tool publishes, stays sha256-hex —
 *   the ecosystem convention `shasum -c` expects.
 *
 * `parseChecksums` reads the hex transport format; `verifyReleaseChecksum`
 * bridges it to the SRI pin through the release kit's dep-zero parser.
 *
 * Fleet-canonical: byte-identical across every repo that ships
 * `scripts/socket-release/build-infra/lib/release-checksums/`. Drift caught by
 * sync-scaffolding.
 */
/* eslint-disable socket/prefer-refined-record -- schema-keyed data */

import crypto from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { findUpPackageJson } from '@socketsecurity/lib/packages/find'

const logger = getDefaultLogger()

export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512'

export interface Hash {
  readonly algorithm: HashAlgorithm
  readonly hex: string
  readonly sri: string
}

// Capture a supported SHA algorithm followed by one base64 digest.
const SRI_RE = /^(sha(?:256|384|512))-([A-Za-z0-9+/]+=*)$/u
const HEX_RE = /^[a-f0-9]+$/iu
const HASH_ALGORITHMS: readonly HashAlgorithm[] = ['sha256', 'sha384', 'sha512']
const HEX_LENGTHS: Readonly<Record<HashAlgorithm, number>> = {
  sha256: 64,
  sha384: 96,
  sha512: 128,
}

export function parseHash(input: string | Hash): Hash {
  if (typeof input === 'object') {
    return makeHash(input.algorithm, input.hex)
  }
  const sriMatch = SRI_RE.exec(input)
  if (sriMatch) {
    const algorithm = sriMatch[1]
    if (!isHashAlgorithm(algorithm)) {
      throw new TypeError('Expected a sha256, sha384, or sha512 digest.')
    }
    const hex = Buffer.from(sriMatch[2]!, 'base64').toString('hex')
    if (hex.length !== HEX_LENGTHS[algorithm]) {
      throw new TypeError(`Invalid ${algorithm} digest length.`)
    }
    return makeHash(algorithm, hex)
  }
  const algorithm = HASH_ALGORITHMS.find(
    candidate => HEX_LENGTHS[candidate] === input.length,
  )
  if (!algorithm || !HEX_RE.test(input)) {
    throw new TypeError('Expected a sha256, sha384, or sha512 digest.')
  }
  return makeHash(algorithm, input)
}

function isHashAlgorithm(value: string | undefined): value is HashAlgorithm {
  return HASH_ALGORITHMS.some(algorithm => algorithm === value)
}

export function equalHashes(
  left: string | Hash,
  right: string | Hash,
): boolean {
  const leftHash = parseHash(left)
  const rightHash = parseHash(right)
  if (leftHash.algorithm !== rightHash.algorithm) {
    return false
  }
  const leftBytes = Buffer.from(leftHash.hex, 'hex')
  const rightBytes = Buffer.from(rightHash.hex, 'hex')
  return (
    leftBytes.length === rightBytes.length &&
    crypto.timingSafeEqual(leftBytes, rightBytes)
  )
}

function makeHash(algorithm: HashAlgorithm, hex: string): Hash {
  const normalized = hex.toLowerCase()
  return Object.freeze({
    algorithm,
    hex: normalized,
    sri: `${algorithm}-${Buffer.from(normalized, 'hex').toString('base64')}`,
  })
}

// ---------------------------------------------------------------------------
// Public types — match the JSON Schema at scripts/socket-release/build-infra/release-assets.schema.json.
// ---------------------------------------------------------------------------

export interface ToolConfig {
  description?: string | undefined
  tag: string
  // SRI integrity strings (`sha256-<base64>`, sha384/sha512 accepted).
  checksums: Record<string, string>
}

export type EmbeddedChecksums = Record<string, ToolConfig>

export interface VerifyResult {
  actual?: string | undefined
  expected?: string | undefined
  source?: string | undefined
  skipped?: boolean | undefined
  valid: boolean
}

// ---------------------------------------------------------------------------
// Embedded loader.
//
// Reads `scripts/socket-release/build-infra/release-assets.json` from the repo root.
// Lazy + cached: file is read at most once per process. The `null` sentinel
// distinguishes "tried and failed" from "not yet tried" so we don't retry
// on every call.
// ---------------------------------------------------------------------------

let embeddedChecksums: EmbeddedChecksums | undefined | null

/**
 * Compute a hash of a file as lowercase hex, streamed so the whole file never
 * loads into memory. Defaults to sha256 — the `checksums.txt` / `shasum -a
 * 256` digest. Streaming avoids loading a release asset into memory. Convert
 * the result to SRI with `parseHash(hex).sri`.
 */
export async function computeFileHash(
  filePath: string,
  algorithm: HashAlgorithm = 'sha256',
): Promise<string> {
  const hash = crypto.createHash(algorithm)
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export function getEmbeddedChecksum(
  tool: string,
  assetName: string,
): { checksum: string; tag: string } | undefined {
  const embedded = getEmbeddedChecksums()
  if (!embedded) {
    return undefined
  }
  const toolConfig = embedded[tool]
  if (!toolConfig?.checksums) {
    return undefined
  }
  const checksum = toolConfig.checksums[assetName]
  if (!checksum) {
    return undefined
  }
  return { checksum, tag: toolConfig.tag }
}

export function getEmbeddedChecksums(): EmbeddedChecksums | undefined {
  if (embeddedChecksums === null) {
    return undefined
  }
  if (embeddedChecksums === undefined) {
    try {
      const checksumPath = path.join(
        path.dirname(findUpPackageJson(import.meta)),
        'release-assets.json',
      )
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
      embeddedChecksums = JSON.parse(
        readFileSync(checksumPath, 'utf8'),
      ) as EmbeddedChecksums
    } catch {
      embeddedChecksums = undefined
      return undefined
    }
  }
  return embeddedChecksums
}

/**
 * Parse `checksums.txt` content into a map.
 *
 * Format: one entry per line, `<sha256-hex> <filename>` (two spaces or any
 * whitespace between hash and name). Blank lines are skipped. Lines that don't
 * match the expected shape are silently ignored — defensive against tools that
 * prepend a header or comments.
 */
export function parseChecksums(content: string): Record<string, string> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
  const checksums: Record<string, string> = { __proto__: null as never }
  const lines = content.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    // Match a SHA-256 checksum line: 64 lowercase hex digits, one or more
    // whitespace characters, then the filename extending to end of line.
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/)
    if (match) {
      checksums[match[2]!] = match[1]!
    }
  }
  return checksums
}

export interface VerifyConfig {
  filePath: string
  assetName: string
  tool: string
  quiet?: boolean | undefined
  // When a tool has no checksums in release-assets.json at all, verification
  // fails closed (`valid: false`) by default — an unverified download must
  // not silently pass an integrity gate. Set `allowUnlisted: true` to opt a
  // not-yet-tracked tool back into the old skip behavior (`valid: true,
  // skipped: true`); use it only where downloading an untracked tool is
  // intentional, and prefer adding the tool to release-assets.json instead.
  allowUnlisted?: boolean | undefined
}

/**
 * Verify a downloaded file against the embedded SRI pin in
 * `release-assets.json`.
 *
 * Embedded checksums are the source of truth. Five outcomes:
 *
 * 1. Embedded match found and the digest agrees → `{ valid: true }`.
 * 2. Embedded match found but the digest disagrees → `{ valid: false }` with
 *    `actual` + `expected` populated. **Fail loudly.**
 * 3. Embedded match found but the pin isn't a recognized SRI/hex string → `{
 *    valid: false }`. The pin itself is malformed; fix it in
 *    `release-assets.json`.
 * 4. Tool is in `release-assets.json` but `assetName` isn't listed → return `{
 *    valid: false }`. The likely cause is a stale embedded manifest; bump
 *    `tag`
 *
 *    - `checksums` in `release-assets.json` and re-run.
 * 5. Tool isn't in `release-assets.json` at all → fail CLOSED: return `{ valid:
 *    false }` with a warning. An untracked tool is an unverified download, so
 *    it must not pass the integrity gate by default. Add the tool to
 *    `release-assets.json`, or pass `allowUnlisted: true` to opt a
 *    deliberately-untracked tool back into `{ valid: true, skipped: true }`.
 */
export async function verifyReleaseChecksum(
  config: VerifyConfig,
): Promise<VerifyResult> {
  const {
    assetName,
    filePath,
    quiet = false,
    tool,
  } = { __proto__: null, ...config } as typeof config

  const embedded = getEmbeddedChecksum(tool, assetName)
  if (embedded) {
    let expectedHash: Hash
    try {
      expectedHash = parseHash(embedded.checksum)
    } catch {
      if (!quiet) {
        logger.fail(
          `Malformed checksum pin for ${assetName} in release-assets.json (tool: ${tool})`,
        )
        logger.fail(
          `Saw "${embedded.checksum}" — wanted a sha256/384/512 SRI string or hex digest. Fix the pin in release-assets.json.`,
        )
      }
      return {
        expected: embedded.checksum,
        source: 'embedded',
        valid: false,
      }
    }
    const actual = await computeFileHash(filePath, expectedHash.algorithm)
    return {
      actual,
      expected: embedded.checksum,
      source: 'embedded',
      valid: equalHashes(actual, expectedHash),
    }
  }

  const embeddedData = getEmbeddedChecksums()
  const toolBlock = embeddedData?.[tool]
  if (toolBlock?.checksums && Object.keys(toolBlock.checksums).length > 0) {
    if (!quiet) {
      logger.fail(
        `No embedded checksum for ${assetName} in release-assets.json (tool: ${tool})`,
      )
      logger.fail(`Bump the tag + checksums in release-assets.json to update`)
    }
    return { source: 'embedded', valid: false }
  }

  if (config.allowUnlisted) {
    if (!quiet) {
      logger.warn(
        `No checksums found for ${tool}; allowUnlisted set, skipping verification`,
      )
    }
    return { skipped: true, valid: true }
  }
  // Fail closed: an untracked tool is unverified, so it must not pass.
  if (!quiet) {
    logger.fail(
      `No checksums found for ${tool} in release-assets.json — refusing to ` +
        `treat the download as verified. Add ${tool} to release-assets.json, ` +
        `or pass allowUnlisted to skip intentionally.`,
    )
  }
  return { skipped: true, valid: false }
}
