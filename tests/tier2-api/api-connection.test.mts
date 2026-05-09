import { describe, it, expect } from 'vitest'

const API_KEY = process.env.SOCKET_SECURITY_API_KEY
const ORG = process.env.SOCKET_ORG || 'SocketDemo'
const BATCH_PURL_URL = `https://api.socket.dev/v0/orgs/${ORG}/purl`

describe('Batch PURL API Connection', () => {
  it('successfully connects and returns data', async () => {
    if (!API_KEY) {
      throw new Error(
        'SOCKET_SECURITY_API_KEY is required for API tests. ' +
          'Set it in your environment to run Tier 2 tests.',
      )
    }

    const response = await fetch(BATCH_PURL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purls: ['pkg:npm/lodash@4.17.21'] }),
    })

    expect(response.ok, `API returned status ${response.status}`).toBe(true)
    const data = await response.json()
    expect(data).toBeDefined()
  })

  it('returns structured package data for a known package', async () => {
    if (!API_KEY) {
      throw new Error('SOCKET_SECURITY_API_KEY is required for API tests.')
    }

    const response = await fetch(BATCH_PURL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purls: ['pkg:npm/lodash@4.17.21'] }),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    // The response should contain package data
    expect(data).toBeDefined()
    expect(typeof data).toBe('object')
  })

  it('handles multiple PURLs in a single request', async () => {
    if (!API_KEY) {
      throw new Error('SOCKET_SECURITY_API_KEY is required for API tests.')
    }

    const response = await fetch(BATCH_PURL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        purls: ['pkg:npm/lodash@4.17.21', 'pkg:npm/express@4.18.2'],
      }),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data).toBeDefined()
  })

  it('handles non-existent packages gracefully', async () => {
    if (!API_KEY) {
      throw new Error('SOCKET_SECURITY_API_KEY is required for API tests.')
    }

    const response = await fetch(BATCH_PURL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        purls: [
          'pkg:npm/this-package-definitely-does-not-exist-xyz-12345@0.0.0',
        ],
      }),
    })

    // Should not crash — either returns an error indication or empty results
    expect(response).toBeDefined()
    const data = await response.json()
    expect(data).toBeDefined()
  })
})
