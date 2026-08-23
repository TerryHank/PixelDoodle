import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaterialPatternImportPayload } from '@/types/material-library'

const { getStorageSyncMock, removeStorageSyncMock, setStorageSyncMock, setStateMock } =
  vi.hoisted(() => ({
    getStorageSyncMock: vi.fn(),
    removeStorageSyncMock: vi.fn(),
    setStorageSyncMock: vi.fn(),
    setStateMock: vi.fn()
  }))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: getStorageSyncMock,
    removeStorageSync: removeStorageSyncMock,
    setStorageSync: setStorageSyncMock
  }
}))

vi.mock('@/store/pattern-store', () => ({
  usePatternStore: {
    setState: setStateMock
  }
}))

import {
  PENDING_MATERIAL_IMPORT_STORAGE_KEY,
  applyMaterialPatternImport,
  consumePendingMaterialImport,
  savePendingMaterialImport
} from '../material-pattern-import'

function payload(): MaterialPatternImportPayload {
  return {
    version: 1,
    kind: 'material-library',
    importId: 'material-test-1',
    createdAt: '2026-08-23T08:00:00.000Z',
    title: '测试图纸',
    material: {
      id: 1,
      source: 'test',
      category: '动物',
      tags: [],
      originalSize: { width: 2, height: 1 }
    },
    boardSize: { width: 2, height: 1 },
    palettePreset: '221',
    pixelMatrix: [['A1', null]],
    colorSummary: [
      {
        code: 'A1',
        name: 'White',
        name_zh: '白色',
        hex: '#FFFFFF',
        rgb: [255, 255, 255],
        count: 1
      }
    ],
    totalBeads: 1,
    colorMapping: []
  }
}

describe('material pattern import handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a versioned handoff for editor hydration', () => {
    const value = payload()
    savePendingMaterialImport(value)
    expect(setStorageSyncMock).toHaveBeenCalledWith(
      PENDING_MATERIAL_IMPORT_STORAGE_KEY,
      value
    )
  })

  it('consumes a valid pending handoff once', () => {
    const value = payload()
    getStorageSyncMock.mockReturnValue(value)
    expect(consumePendingMaterialImport()).toEqual(value)
    expect(removeStorageSyncMock).toHaveBeenCalledWith(
      PENDING_MATERIAL_IMPORT_STORAGE_KEY
    )
  })

  it('hydrates the existing pattern store without mutating the payload matrix', () => {
    const value = payload()
    applyMaterialPatternImport(value)

    expect(setStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        boardSize: { width: 2, height: 1 },
        gridSize: { width: 2, height: 1 },
        pixelMatrix: [['A1', null]],
        totalBeads: 1,
        sessionId: 'material-test-1'
      })
    )
    const storedMatrix = setStateMock.mock.calls[0][0].pixelMatrix
    expect(storedMatrix).not.toBe(value.pixelMatrix)
  })
})
