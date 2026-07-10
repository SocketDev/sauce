import { describe, expect, it } from 'vitest'
const app = require('../src/index.js')

describe('app', () => {
  it('exports an express app', () => {
    expect(app).toBeDefined()
    expect(typeof app.get).toBe('function')
  })
})
