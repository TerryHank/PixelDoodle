import { describe, expect, it } from 'vitest'

import {
  __localGenerationJsInternals,
  generatePatternLocalJs,
  resolveLocalGridSize
} from './local-generation-js'

function createSolidRaster(
  width: number,
  height: number,
  rgb: [number, number, number]
) {
  const data = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < data.length; index += 4) {
    data[index] = rgb[0]
    data[index + 1] = rgb[1]
    data[index + 2] = rgb[2]
    data[index + 3] = 255
  }

  return {
    width,
    height,
    data
  }
}

function createQuadrantRaster() {
  const width = 8
  const height = 8
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const isBlack = x < 4
      data[index] = isBlack ? 0 : 255
      data[index + 1] = isBlack ? 0 : 255
      data[index + 2] = isBlack ? 0 : 255
      data[index + 3] = 255
    }
  }

  return {
    width,
    height,
    data
  }
}

describe('local-generation-js', () => {
  it('resolves pixel-size mode from source dimensions', () => {
    expect(
      resolveLocalGridSize(320, 256, {
        mode: 'pixel_size',
        grid_width: 0,
        grid_height: 0,
        led_size: 64,
        pixel_size: 8,
        use_dithering: false,
        palette_preset: '221',
        max_colors: 0,
        similarity_threshold: 0,
        remove_bg: false,
        contrast: 0,
        saturation: 0,
        sharpness: 0
      })
    ).toEqual({
      width: 40,
      height: 32
    })
  })

  it('builds a deterministic pixel matrix from local rasters', () => {
    const result = generatePatternLocalJs({
      sourceWidth: 8,
      sourceHeight: 8,
      selectionRaster: createQuadrantRaster(),
      midRaster: createQuadrantRaster(),
      options: {
        mode: 'fixed_grid',
        grid_width: 2,
        grid_height: 2,
        led_size: 64,
        pixel_size: 8,
        use_dithering: false,
        palette_preset: '221',
        max_colors: 2,
        similarity_threshold: 0,
        remove_bg: false,
        contrast: 0,
        saturation: 0,
        sharpness: 0
      },
      colors: [
        {
          code: 'A1',
          name: 'Black',
          name_zh: '黑色',
          hex: '#000000',
          rgb: [0, 0, 0]
        },
        {
          code: 'B1',
          name: 'White',
          name_zh: '白色',
          hex: '#FFFFFF',
          rgb: [255, 255, 255]
        }
      ],
      presets: {}
    })

    expect(result.grid_size).toEqual({
      width: 2,
      height: 2
    })
    expect(result.pixel_matrix).toEqual([
      ['A1', 'B1'],
      ['A1', 'B1']
    ])
    expect(result.total_beads).toBe(4)
    expect(result.color_summary.map((item) => [item.code, item.count])).toEqual([
      ['A1', 2],
      ['B1', 2]
    ])
  })

  it('cleans rare colors and smooths isolated pixels like the Rust engine', () => {
    const paletteState = __localGenerationJsInternals.buildPaletteState(
      [
        {
          code: 'A1',
          name: 'Near Black',
          name_zh: '近黑',
          hex: '#000000',
          rgb: [0, 0, 0]
        },
        {
          code: 'A2',
          name: 'Dark Gray',
          name_zh: '深灰',
          hex: '#101010',
          rgb: [16, 16, 16]
        },
        {
          code: 'A3',
          name: 'White',
          name_zh: '白色',
          hex: '#FFFFFF',
          rgb: [255, 255, 255]
        }
      ],
      {}
    )

    const rareMatrix = [
      [0, 0, 0],
      [0, 2, 0],
      [0, 0, 0]
    ] satisfies (number | null)[][]

    __localGenerationJsInternals.cleanupRareColors(rareMatrix, paletteState, 9, 0.5)
    expect(rareMatrix).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ])

    const edgeMatrix = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0]
    ] satisfies (number | null)[][]

    __localGenerationJsInternals.smoothEdges(edgeMatrix, paletteState)
    expect(edgeMatrix).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ])
  })
})
