/**
 * @file ConformsToLaw pins every field of the trusted-publisher law. One case
 *   per field diverges exactly that field and asserts the config no longer
 *   conforms, so dropping any single comparison (type, file, repository,
 *   environment, or the permission set) fails a test — the sweep's idempotent
 *   no-op can never green-light a config bound to the wrong workflow,
 *   environment, or repo.
 */

import { describe, expect, it } from 'vitest'

import {
  conformsToLaw,
  trustedPublisherLaw,
} from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/trust-sweep.mts'
import type { TrustConfig } from '../../../../../../release-kit/payload/scripts/socket-release/publish-infra/npm/trust-sweep.mts'

const LAW = trustedPublisherLaw('SocketDev/example')

function conformingConfig(): TrustConfig {
  return {
    environment: 'npm-publish',
    file: 'npm-publish.yml',
    id: 'tp-001',
    permissions: ['createPackage', 'createStagedPackage'],
    repository: 'SocketDev/example',
    type: 'github',
  }
}

describe('conformsToLaw', () => {
  it('accepts a config that matches the law on every field', () => {
    expect(conformsToLaw(conformingConfig(), LAW)).toBe(true)
  })

  it('is order-independent on the permission set', () => {
    const swapped = {
      ...conformingConfig(),
      permissions: ['createStagedPackage', 'createPackage'],
    }
    expect(conformsToLaw(swapped, LAW)).toBe(true)
  })

  const divergences: Array<{
    field: string
    mutate: (c: TrustConfig) => void
  }> = [
    { field: 'type', mutate: c => (c.type = 'gitlab') },
    { field: 'file', mutate: c => (c.file = 'release.yml') },
    { field: 'repository', mutate: c => (c.repository = 'SocketDev/other') },
    { field: 'environment', mutate: c => (c.environment = 'production') },
    {
      field: 'permissions (missing one)',
      mutate: c => (c.permissions = ['createPackage']),
    },
    {
      field: 'permissions (extra one)',
      mutate: c =>
        (c.permissions = [
          'createPackage',
          'createStagedPackage',
          'deletePackage',
        ]),
    },
  ]

  for (const { field, mutate } of divergences) {
    it(`rejects a config that diverges on ${field}`, () => {
      const config = conformingConfig()
      mutate(config)
      expect(conformsToLaw(config, LAW)).toBe(false)
    })
  }
})
