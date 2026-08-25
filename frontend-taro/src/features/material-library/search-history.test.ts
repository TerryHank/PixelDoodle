import { describe, expect, it } from 'vitest'
import {
  normalizeMaterialSearchQuery,
  recordMaterialSearch
} from './search-history'

describe('material search history', () => {
  it('trims searches and enforces the 20-character product limit', () => {
    expect(normalizeMaterialSearchQuery('  皮卡丘 像素图  ')).toBe('皮卡丘 像素图')
    expect(normalizeMaterialSearchQuery('123456789012345678901234')).toBe('12345678901234567890')
  })

  it('moves duplicate searches to the front and keeps twenty entries', () => {
    const existing = Array.from({ length: 20 }, (_, index) => `关键词${index}`)
    expect(recordMaterialSearch(existing, '关键词9')).toEqual([
      '关键词9',
      ...existing.filter((item) => item !== '关键词9')
    ])
    expect(recordMaterialSearch(existing, '新关键词')).toHaveLength(20)
    expect(recordMaterialSearch(existing, '   ')).toEqual(existing)
  })
})
