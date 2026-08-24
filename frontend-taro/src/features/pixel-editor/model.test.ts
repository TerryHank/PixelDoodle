import { describe, expect, it } from 'vitest'
import type { PaletteColor, PalettePresetMap } from '@/types/api'
import {
  BOARD_SIZE_OPTIONS,
  applyPaletteToPixelMatrix,
  buildPixelColorSummary,
  createEmptyPixelMatrix,
  floodFillPixelMatrix,
  getBoardSize,
  rasterizeGridLine,
  resizePixelMatrix,
  setPixelCell
} from './model'

const colors: PaletteColor[] = [
  { code: 'R', name: 'Red', name_zh: '红', hex: '#ff0000', rgb: [255, 0, 0] },
  { code: 'D', name: 'Dark red', name_zh: '深红', hex: '#cc0000', rgb: [204, 0, 0] },
  { code: 'B', name: 'Blue', name_zh: '蓝', hex: '#0000ff', rgb: [0, 0, 255] }
]

const presets: PalettePresetMap = {
  warm: { label: '暖色', codes: ['D'] },
  all: { label: '全部', codes: null }
}

describe('pixel editor model', () => {
  it('keeps the six requested board sizes in product order', () => {
    expect(BOARD_SIZE_OPTIONS.map((option) => option.id)).toEqual([
      '29x29',
      '32x32',
      '52x52',
      '78x78',
      '104x104',
      '104x74'
    ])
  })

  it('exposes the requested rectangular board size', () => {
    expect(getBoardSize('104x74')).toMatchObject({ width: 104, height: 74 })
  })

  it('paints and flood-fills without mutating the source matrix', () => {
    const source = createEmptyPixelMatrix(3, 2)
    const painted = setPixelCell(source, 1, 0, 'R')
    const filled = floodFillPixelMatrix(painted, 0, 0, 'B')

    expect(source).toEqual([
      [null, null, null],
      [null, null, null]
    ])
    expect(filled).toEqual([
      ['B', 'R', 'B'],
      ['B', 'B', 'B']
    ])
  })

  it('remaps unavailable colors to the closest selected palette color', () => {
    expect(applyPaletteToPixelMatrix([['R', 'B', null]], colors, presets, 'warm')).toEqual([
      ['D', 'D', null]
    ])
  })

  it('keeps artwork centered when the board is resized', () => {
    expect(resizePixelMatrix([['R']], 3, 3)).toEqual([
      [null, null, null],
      [null, 'R', null],
      [null, null, null]
    ])
  })

  it('rebuilds bead counts after editing', () => {
    expect(buildPixelColorSummary([['R', 'R', null], ['B', null, null]], colors)).toEqual([
      expect.objectContaining({ code: 'R', count: 2 }),
      expect.objectContaining({ code: 'B', count: 1 })
    ])
  })

  it('fills every grid cell between sparse pointer events', () => {
    expect(rasterizeGridLine({ x: 1, y: 1 }, { x: 5, y: 3 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 3 }
    ])
  })
})
