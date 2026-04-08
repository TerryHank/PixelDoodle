import { describe, expect, it } from 'vitest'

import { buildCanvasRenderModel, formatColorTotalText } from '../h5-canvas'

describe('buildCanvasRenderModel', () => {
  it('fits the pattern into a 640x640 canvas like the original page', () => {
    const model = buildCanvasRenderModel({
      gridWidth: 64,
      gridHeight: 64,
      activeCodes: new Set<string>(),
      pixelMatrix: Array.from({ length: 64 }, () =>
        Array.from({ length: 64 }, () => 'A1')
      )
    })

    expect(model.cellSize).toBe(10)
    expect(model.canvasWidth).toBe(640)
    expect(model.canvasHeight).toBe(640)
  })

  it('marks non-highlighted cells when active colors exist', () => {
    const model = buildCanvasRenderModel({
      gridWidth: 2,
      gridHeight: 1,
      activeCodes: new Set(['A1']),
      pixelMatrix: [['A1', 'B2']]
    })

    expect(model.cells[1].masked).toBe(true)
  })
})

describe('formatColorTotalText', () => {
  it('matches the original generated-state summary copy', () => {
    expect(formatColorTotalText(16, 3001)).toBe('16 种颜色, 共 3001 颗珠子')
  })
})
