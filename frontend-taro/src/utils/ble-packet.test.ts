import { describe, expect, it } from 'vitest'

import { pixelMatrixToRgb565Bytes } from './ble-packet'

describe('pixelMatrixToRgb565Bytes', () => {
  it('encodes transparent background separately from true black pixels', () => {
    const payload = pixelMatrixToRgb565Bytes(
      [[null, 'A1']],
      {
        A1: {
          code: 'A1',
          name: 'Black',
          name_zh: '黑色',
          hex: '#000000',
          rgb: [0, 0, 0]
        }
      },
      [0, 0, 0]
    )

    expect(Array.from(payload.slice(0, 4))).toEqual([1, 0, 0, 0])
  })

  it('preserves non-black backgrounds without using the transparent marker', () => {
    const payload = pixelMatrixToRgb565Bytes([[null]], {}, [255, 255, 255])

    expect(Array.from(payload.slice(0, 2))).toEqual([255, 255])
  })
})
