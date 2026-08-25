import { describe, expect, it } from 'vitest'
import type { PatternHistoryEntry } from '@/types/community'
import { filterLocalGallery } from './model'

const entries = [
  {
    id: '2', title: '皮卡丘', sourceLabel: '素材套用', createdAt: '2026-02-02T00:00:00Z',
    gridSize: { width: 29, height: 29 }, totalBeads: 1, palettePreset: 'all',
    pixelMatrix: [['A1']], colorSummary: []
  },
  {
    id: '1', title: '小猫', sourceLabel: '自由创作', createdAt: '2026-01-01T00:00:00Z',
    gridSize: { width: 32, height: 32 }, totalBeads: 1, palettePreset: 'all',
    pixelMatrix: [['A1']], colorSummary: []
  }
] satisfies PatternHistoryEntry[]

describe('local gallery model', () => {
  it('filters by keyword and exact board size', () => {
    expect(filterLocalGallery(entries, '素材', '29x29', 'newest').map((item) => item.id)).toEqual(['2'])
  })

  it('sorts oldest first', () => {
    expect(filterLocalGallery(entries, '', 'all', 'oldest').map((item) => item.id)).toEqual(['1', '2'])
  })
})
