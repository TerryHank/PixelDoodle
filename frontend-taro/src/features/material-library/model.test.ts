import { describe, expect, it } from 'vitest'
import { BOARD_SIZE_OPTIONS } from '@/features/pixel-editor/model'
import type { PaletteColor } from '@/types/api'
import type { MaterialGalleryWork } from '@/types/material-library'
import {
  buildMaterialPatternImport,
  decodeMaterialPaletteIndices,
  fitPixelMatrixToBoard,
  validateMaterialGalleryWork
} from './model'

const COLORS: PaletteColor[] = [
  {
    code: 'A1',
    name: 'White',
    name_zh: '白色',
    hex: '#FFFFFF',
    rgb: [255, 255, 255]
  },
  {
    code: 'B1',
    name: 'Black',
    name_zh: '黑色',
    hex: '#000000',
    rgb: [0, 0, 0]
  }
]

function galleryWork(overrides: Partial<MaterialGalleryWork> = {}): MaterialGalleryWork {
  return {
    v: 2,
    access: 'public',
    id: 1655,
    title: '测试兔子',
    width: 3,
    height: 2,
    palette: ['#050505', '#FAFAFA'],
    keys: ['source-black', 'source-white'],
    grid: '00ff010100ff',
    createdAt: '2026-08-23T00:00:00.000Z',
    source: 'pindou-fun',
    category: '动物',
    tags: ['兔子', '可爱'],
    ...overrides
  }
}

describe('material library model', () => {
  it('decodes the canonical two-hex-character grid format', () => {
    expect(decodeMaterialPaletteIndices(galleryWork())).toEqual([
      [0, null, 1],
      [1, 0, null]
    ])
  })

  it('rejects malformed gallery records before import', () => {
    expect(() =>
      validateMaterialGalleryWork(galleryWork({ grid: '00ff' }))
    ).toThrow('grid 长度或编码无效')
    expect(() =>
      validateMaterialGalleryWork(galleryWork({ keys: ['only-one'] }))
    ).toThrow('palette 与 keys 数量不一致')
  })

  it('fits a material to a board with nearest-neighbour scaling and centering', () => {
    expect(fitPixelMatrixToBoard([['A1', 'B1']], { width: 4, height: 4 })).toEqual([
      [null, null, null, null],
      ['A1', 'A1', 'B1', 'B1'],
      ['A1', 'A1', 'B1', 'B1'],
      [null, null, null, null]
    ])
  })

  it('maps source colors to the current professional palette and builds an editor contract', () => {
    const payload = buildMaterialPatternImport(galleryWork(), {
      boardSize: { width: 6, height: 4 },
      colors: COLORS,
      palettePreset: '221',
      createdAt: '2026-08-23T08:00:00.000Z'
    })

    expect(payload.version).toBe(1)
    expect(payload.kind).toBe('material-library')
    expect(payload.boardSize).toEqual({ width: 6, height: 4 })
    expect(payload.pixelMatrix).toHaveLength(4)
    expect(payload.pixelMatrix.every((row) => row.length === 6)).toBe(true)
    expect(payload.colorMapping).toEqual([
      {
        sourceHex: '#050505',
        sourceKey: 'source-black',
        targetCode: 'B1'
      },
      {
        sourceHex: '#FAFAFA',
        sourceKey: 'source-white',
        targetCode: 'A1'
      }
    ])
    expect(payload.totalBeads).toBeGreaterThan(0)
    expect(payload.colorSummary.reduce((sum, item) => sum + item.count, 0)).toBe(
      payload.totalBeads
    )
  })

  it('produces editor-sized matrices for all six supported pegboards', () => {
    for (const board of BOARD_SIZE_OPTIONS) {
      const payload = buildMaterialPatternImport(galleryWork(), {
        boardSize: board,
        colors: COLORS,
        palettePreset: '221',
        createdAt: '2026-08-23T08:00:00.000Z'
      })
      expect(payload.pixelMatrix).toHaveLength(board.height)
      expect(payload.pixelMatrix.every((row) => row.length === board.width)).toBe(true)
    }
  })
})
