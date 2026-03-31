import { describe, expect, it } from 'vitest'
import { buildGenerateFields } from '../pattern-service'

describe('pattern service', () => {
  it('serializes generate options', () => {
    const fields = buildGenerateFields({
      gridWidth: 48,
      gridHeight: 48,
      palettePreset: '221'
    })

    expect(fields.grid_width).toBe('48')
    expect(fields.grid_height).toBe('48')
    expect(fields.palette_preset).toBe('221')
  })
})
