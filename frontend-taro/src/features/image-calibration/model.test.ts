import { describe, expect, it } from 'vitest'
import {
  clampCropRect,
  createAspectCropRect,
  createFullImageCropRect,
  fitImageWithinBoardGrid,
  getCalibrationGridBackgroundSize,
  zoomCropRect
} from './model'

describe('image calibration model', () => {
  it('uses a square crop for 29x29 boards', () => {
    const crop = createAspectCropRect(1200, 800, 29, 29)
    expect(crop.width / crop.height).toBeCloseTo(1)
    expect(crop).toMatchObject({ x: 200, y: 0, width: 800, height: 800 })
  })

  it('uses the exact 104x74 aspect ratio', () => {
    const crop = createAspectCropRect(1200, 800, 104, 74)
    expect(crop.width / crop.height).toBeCloseTo(52 / 37)
  })

  it('preserves the complete portrait image and fits its longest edge to the board', () => {
    expect(createFullImageCropRect(1080, 2400)).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 2400
    })
    expect(fitImageWithinBoardGrid(1080, 2400, 29, 29)).toEqual({
      width: 13,
      height: 29
    })
  })

  it('fits landscape and rectangular sources inside the selected board', () => {
    expect(fitImageWithinBoardGrid(2400, 1080, 29, 29)).toEqual({
      width: 29,
      height: 13
    })
    expect(fitImageWithinBoardGrid(1200, 800, 104, 74)).toEqual({
      width: 104,
      height: 69
    })
  })

  it('renders one calibration cell per selected board column and row', () => {
    expect(getCalibrationGridBackgroundSize(104, 74)).toBe(
      'calc(100% / 104) calc(100% / 74)'
    )
  })

  it('zooms around the current center and clamps to the source image', () => {
    const base = createAspectCropRect(1000, 600, 104, 74)
    const zoomed = zoomCropRect(base, base, 1000, 600, 2)
    const moved = clampCropRect({ ...zoomed, x: 999, y: -20 }, 1000, 600)

    expect(zoomed.width).toBeCloseTo(base.width / 2)
    expect(moved.x + moved.width).toBeCloseTo(1000)
    expect(moved.y).toBe(0)
  })
})
