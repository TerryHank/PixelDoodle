import { describe, expect, it } from 'vitest'

import { buildPaletteLookup } from '../export'

describe('buildPaletteLookup', () => {
  it('keeps used colors available even when the full palette map is incomplete', () => {
    const lookup = buildPaletteLookup(
      [['A1', 'B2']],
      [
        {
          code: 'A1',
          name: 'White',
          name_zh: '白色',
          hex: '#FFFFFF',
          rgb: [255, 255, 255],
          count: 1
        },
        {
          code: 'B2',
          name: 'Blue',
          name_zh: '蓝色',
          hex: '#0000FF',
          rgb: [0, 0, 255],
          count: 1
        }
      ],
      {}
    )

    expect(lookup.A1?.rgb).toEqual([255, 255, 255])
    expect(lookup.B2?.rgb).toEqual([0, 0, 255])
  })
})
