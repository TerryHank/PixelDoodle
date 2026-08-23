import { describe, expect, it } from 'vitest'

import type { PatternHistoryEntry } from '@/types/community'
import { buildPatternStateFromHistory } from './history'

describe('buildPatternStateFromHistory', () => {
  it('builds an editable pattern state without sharing history arrays', () => {
    const entry: PatternHistoryEntry = {
      id: 'saved-1',
      title: '测试作品',
      createdAt: '2026-08-23T00:00:00.000Z',
      sourceLabel: '自由创作',
      gridSize: { width: 2, height: 2 },
      totalBeads: 2,
      palettePreset: '221',
      pixelMatrix: [
        ['A1', null],
        [null, 'A2']
      ],
      colorSummary: [
        {
          code: 'A1',
          name: 'White',
          name_zh: '白色',
          hex: '#FFFFFF',
          rgb: [255, 255, 255],
          count: 1
        },
        {
          code: 'A2',
          name: 'Black',
          name_zh: '黑色',
          hex: '#000000',
          rgb: [0, 0, 0],
          count: 1
        }
      ]
    }

    const restored = buildPatternStateFromHistory(entry)

    expect(restored.boardSize).toEqual({ width: 2, height: 2 })
    expect(restored.gridSize).toEqual({ width: 2, height: 2 })
    expect(restored.pixelMatrix).toEqual(entry.pixelMatrix)
    expect(restored.sessionId).toBe('history-saved-1')
    expect(restored.lastGenerationMode).toBeNull()

    restored.pixelMatrix[0][0] = 'A2'
    expect(entry.pixelMatrix[0][0]).toBe('A1')
  })
})
