import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readPersistedStateMock, writePersistedStateMock } = vi.hoisted(() => ({
  readPersistedStateMock: vi.fn(() => []),
  writePersistedStateMock: vi.fn(() => true)
}))

vi.mock('@/utils/persistence', () => ({
  readPersistedState: readPersistedStateMock,
  writePersistedState: writePersistedStateMock
}))

import { useHistoryStore } from './history-store'

const entry = {
  id: 'entry-1',
  title: '测试作品',
  createdAt: '2026-08-24T00:00:00.000Z',
  sourceLabel: '自动备份',
  gridSize: { width: 2, height: 2 },
  totalBeads: 1,
  palettePreset: '221',
  pixelMatrix: [['A1', null], [null, null]],
  colorSummary: []
}

describe('history store persistence result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writePersistedStateMock.mockReturnValue(true)
    useHistoryStore.setState({ entries: [] })
  })

  it('reports a successful durable backup', () => {
    expect(useHistoryStore.getState().addEntry(entry)).toBe(true)
    expect(useHistoryStore.getState().entries).toEqual([entry])
  })

  it('reports storage failure so callers can abort destructive replacement', () => {
    writePersistedStateMock.mockReturnValue(false)

    expect(useHistoryStore.getState().addEntry(entry)).toBe(false)
    expect(useHistoryStore.getState().entries).toEqual([entry])
  })
})
