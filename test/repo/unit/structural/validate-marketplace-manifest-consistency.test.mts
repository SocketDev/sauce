import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { validateMarketplace } from '../../../../scripts/repo/lib/validate-marketplace.mts'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
)

it('passes shared marketplace validation for the skills tree', () => {
  const errors = validateMarketplace(
    path.join(REPO_ROOT, 'skills'),
    path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'),
  )
  expect(
    errors,
    `Marketplace validation errors:\n${errors.map(e => `  - ${e.message}`).join('\n')}`,
  ).toEqual([])
})
