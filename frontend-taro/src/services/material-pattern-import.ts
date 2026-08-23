import Taro from '@tarojs/taro'
import { usePatternStore } from '@/store/pattern-store'
import type { MaterialPatternImportPayload } from '@/types/material-library'

export const PENDING_MATERIAL_IMPORT_STORAGE_KEY =
  'pixeldoodle:pending-material-import:v1'

export function isMaterialPatternImportPayload(
  value: unknown
): value is MaterialPatternImportPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<MaterialPatternImportPayload>
  const boardSize = payload.boardSize
  const matrix = payload.pixelMatrix
  return Boolean(
    payload.version === 1 &&
      payload.kind === 'material-library' &&
      typeof payload.importId === 'string' &&
      payload.importId &&
      typeof payload.title === 'string' &&
      boardSize &&
      Number.isInteger(boardSize.width) &&
      boardSize.width > 0 &&
      Number.isInteger(boardSize.height) &&
      boardSize.height > 0 &&
      Array.isArray(matrix) &&
      matrix.length === boardSize.height &&
      matrix.every(
        (row) =>
          Array.isArray(row) &&
          row.length === boardSize.width &&
          row.every((cell) => cell === null || typeof cell === 'string')
      ) &&
      Array.isArray(payload.colorSummary) &&
      typeof payload.totalBeads === 'number'
  )
}

export function savePendingMaterialImport(payload: MaterialPatternImportPayload) {
  if (!isMaterialPatternImportPayload(payload)) {
    throw new Error('素材导入数据无效')
  }
  Taro.setStorageSync(PENDING_MATERIAL_IMPORT_STORAGE_KEY, payload)
}

export function readPendingMaterialImport() {
  const value = Taro.getStorageSync(PENDING_MATERIAL_IMPORT_STORAGE_KEY) as unknown
  return isMaterialPatternImportPayload(value) ? value : null
}

export function consumePendingMaterialImport() {
  const payload = readPendingMaterialImport()
  if (payload) {
    Taro.removeStorageSync(PENDING_MATERIAL_IMPORT_STORAGE_KEY)
  }
  return payload
}

export function applyMaterialPatternImport(payload: MaterialPatternImportPayload) {
  if (!isMaterialPatternImportPayload(payload)) {
    throw new Error('素材导入数据无效')
  }

  usePatternStore.setState({
    originalImage: null,
    generatedImage: null,
    exampleImage: `material:${payload.material.source}:${payload.material.id}`,
    previewImage: null,
    sessionId: payload.importId,
    pixelMatrix: payload.pixelMatrix.map((row) => [...row]),
    colorSummary: payload.colorSummary.map((item) => ({ ...item })),
    gridSize: { ...payload.boardSize },
    boardSize: { ...payload.boardSize },
    totalBeads: payload.totalBeads,
    palettePreset: payload.palettePreset,
    isGenerating: false,
    lastGenerationMode: null
  })
}
