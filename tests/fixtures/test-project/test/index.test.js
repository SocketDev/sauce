const { describe, it, expect } = require('vitest')
const app = require('../src/index.js')

describe('app', () => {
  it('exports an express app', () => {
    expect(app).toBeDefined()
    expect(typeof app.get).toBe('function')
  })
})
