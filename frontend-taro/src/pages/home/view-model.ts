import type { PixelMatrix } from '@/types/api'

export interface BuildHomeViewModelInput {
  pixelMatrix: PixelMatrix
  targetDeviceUuid: string
  colorSummaryCount?: number
}

function hasGeneratedPattern(pixelMatrix: PixelMatrix) {
  return pixelMatrix.some((row) => row.length > 0)
}

export function buildHomeViewModel(input: BuildHomeViewModelInput) {
  const hasPattern = hasGeneratedPattern(input.pixelMatrix)

  return {
    showUploadGuide: !hasPattern,
    showDeviceChip: Boolean(input.targetDeviceUuid),
    showExampleGallery: !hasPattern,
    showColorPanel: (input.colorSummaryCount ?? 0) > 0
  }
}
