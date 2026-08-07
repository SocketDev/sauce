/**
 * @file The pure cargo metadata helpers the staged/direct crate flows share:
 *   the crates.io publishability rule and the packaged-artifact path.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CARGO_APPROVE_COMMAND,
  cratePath,
  isPublishable,
} from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/cargo/shared.mts'

describe('isPublishable', () => {
  it('treats the Cargo.toml default (null/undefined) as publishable', () => {
    expect(isPublishable(null)).toBe(true)
    expect(isPublishable(undefined)).toBe(true)
  })

  it('treats a non-empty registry allowlist as publishable', () => {
    expect(isPublishable(['crates-io'])).toBe(true)
  })

  it('treats an explicit empty allowlist (publish = false) as not publishable', () => {
    expect(isPublishable([])).toBe(false)
  })

  it('treats any non-array truthy value as not publishable', () => {
    expect(isPublishable('crates-io')).toBe(false)
    expect(isPublishable(true)).toBe(false)
    expect(isPublishable(0)).toBe(false)
  })
})

describe('cratePath', () => {
  it('resolves the target/package/<name>-<version>.crate artifact', () => {
    const p = cratePath('mycrate', '1.2.3')
    expect(
      p.endsWith(path.join('target', 'package', 'mycrate-1.2.3.crate')),
    ).toBe(true)
    expect(path.isAbsolute(p)).toBe(true)
  })
})

describe('CARGO_APPROVE_COMMAND', () => {
  it('is the channel-enforced approve script', () => {
    expect(CARGO_APPROVE_COMMAND).toBe('pnpm run cargo:publish --approve')
  })
})
