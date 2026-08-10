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
    expect(model.displayWidth).toBe(640)
    expect(model.displayHeight).toBe(640)
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

  it('keeps the visible canvas size stable across difficulty levels when the viewport is narrower than 640px', () => {
    const coarseModel = buildCanvasRenderModel({
      gridWidth: 64,
      gridHeight: 64,
      activeCodes: new Set<string>(),
      pixelMatrix: Array.from({ length: 64 }, () =>
        Array.from({ length: 64 }, () => 'A1')
      ),
      maxPatternDim: 640,
      displayMaxPatternDim: 320
    })
    const denseModel = buildCanvasRenderModel({
      gridWidth: 512,
      gridHeight: 512,
      activeCodes: new Set<string>(),
      pixelMatrix: Array.from({ length: 512 }, () =>
        Array.from({ length: 512 }, () => 'A1')
      ),
      maxPatternDim: 640,
      displayMaxPatternDim: 320
    })

    expect(coarseModel.displayWidth).toBe(320)
    expect(coarseModel.displayHeight).toBe(320)
    expect(denseModel.displayWidth).toBe(320)
    expect(denseModel.displayHeight).toBe(320)
  })
})

describe('formatColorTotalText', () => {
  it('matches the original generated-state summary copy', () => {
    expect(formatColorTotalText(16, 3001)).toBe('16 种颜色, 共 3001 颗珠子')
  })
})
