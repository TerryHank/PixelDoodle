import { describe, expect, it } from 'vitest'
import type { PaletteColor } from '@/types/api'
import {
  adjustInventoryQuantity,
  buildInventoryCsv,
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
})
