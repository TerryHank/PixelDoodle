import { describe, expect, it } from 'vitest'

import { buildFixedBoardPreviewLayout } from './preview-layout'

describe('buildFixedBoardPreviewLayout', () => {
  it('keeps the preview canvas fixed while smaller boards use larger bead cells', () => {
    const small = buildFixedBoardPreviewLayout(29, 29)
    const large = buildFixedBoardPreviewLayout(104, 104)

    expect(small.bitmapSize).toBe(large.bitmapSize)
    expect(small.cellSize).toBeGreaterThan(large.cellSize)
    expect(small.offsetX).toBe(0)
    expect(large.offsetX).toBe(0)
  })

  it('centers a rectangular board inside the same square preview and leaves white space', () => {
    const layout = buildFixedBoardPreviewLayout(104, 74)

    expect(layout.offsetX).toBe(0)
    expect(layout.offsetY).toBeGreaterThan(0)
    expect(layout.offsetY).toBeCloseTo((624 - 74 * 6) / 2)
  })
})
