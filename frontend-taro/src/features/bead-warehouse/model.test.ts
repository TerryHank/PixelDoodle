import { describe, expect, it } from 'vitest'
import type { PaletteColor } from '@/types/api'
import {
  analyzePatternInventory,
  adjustInventoryQuantity,
  buildInventoryCsv,
  deductPatternInventory,
  filterInventoryRows,
  parseInventoryCsv
} from './model'

const colors: PaletteColor[] = [
  { code: 'A1', name: 'White', name_zh: '白色', hex: '#fff', rgb: [255, 255, 255] },
  { code: 'B2', name: 'Blue', name_zh: '蓝色', hex: '#00f', rgb: [0, 0, 255] }
]

describe('bead warehouse model', () => {
  it('handles stock in, stock out and calibration without negative inventory', () => {
    expect(adjustInventoryQuantity(100, 'in', 25)).toBe(125)
    expect(adjustInventoryQuantity(100, 'out', 125)).toBe(0)
    expect(adjustInventoryQuantity(100, 'set', 8)).toBe(8)
  })

  it('filters low inventory and sorts by quantity', () => {
    const rows = filterInventoryRows(colors, { A1: 20, B2: 300 }, {
      query: '', status: 'low', series: 'all', sort: 'quantity-desc', lowThreshold: 50
    })
    expect(rows.map((row) => row.color.code)).toEqual(['A1'])
  })

  it('validates and exports CSV inventory', () => {
    expect(parseInventoryCsv('colorCode,quantity\nA1,12\nA1,2\nZ9,3', new Set(['A1']))).toEqual({
      values: { A1: 12 },
      errors: ['第 3 行色号 A1 重复', '第 4 行未知色号 Z9']
    })
    expect(buildInventoryCsv(colors, { A1: 12 })).toContain('A1,12\nB2,0')
  })

  it('calculates current-pattern shortages before changing stock', () => {
    const requirements = analyzePatternInventory([
      { ...colors[0], count: 30 },
      { ...colors[1], count: 12 }
    ], { A1: 40, B2: 5 })

    expect(requirements).toEqual([
      expect.objectContaining({ code: 'B2', required: 12, available: 5, remaining: 0, shortage: 7 }),
      expect.objectContaining({ code: 'A1', required: 30, available: 40, remaining: 10, shortage: 0 })
    ])
    expect(deductPatternInventory({ A1: 40, B2: 5 }, requirements)).toEqual({
      applied: false,
      quantities: { A1: 40, B2: 5 },
      shortages: [expect.objectContaining({ code: 'B2', shortage: 7 })]
    })
  })

  it('deducts a sufficient current pattern atomically without negative stock', () => {
    const requirements = analyzePatternInventory([
      { ...colors[0], count: 30 },
      { ...colors[1], count: 12 }
    ], { A1: 40, B2: 20 })

    expect(deductPatternInventory({ A1: 40, B2: 20, C3: 9 }, requirements)).toEqual({
      applied: true,
      quantities: { A1: 10, B2: 8, C3: 9 },
      shortages: []
    })
  })
})
