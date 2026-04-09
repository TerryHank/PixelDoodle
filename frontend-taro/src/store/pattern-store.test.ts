import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/pattern-service', () => ({
  fetchPalette: vi.fn(),
  generatePattern: vi.fn(),
  buildGenerateFields: vi.fn()
}))

import { usePatternStore } from './pattern-store'

describe('pattern store defaults', () => {
  it('keeps background removal disabled by default', () => {
    expect(usePatternStore.getState().removeBackground).toBe(false)
  })
})
