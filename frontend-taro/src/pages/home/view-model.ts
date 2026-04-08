import type { PixelMatrix } from '@/types/api'

export interface BuildHomeViewModelInput {
  pixelMatrix: PixelMatrix
  targetDeviceUuid: string
  colorSummaryCount?: number
  env?: string
}

function hasGeneratedPattern(pixelMatrix: PixelMatrix) {
  return pixelMatrix.some((row) => row.length > 0)
}

export function buildHomeViewModel(input: BuildHomeViewModelInput) {
  const hasPattern = hasGeneratedPattern(input.pixelMatrix)
  const targetDeviceUuid = input.targetDeviceUuid.trim()

  return {
    showUploadGuide: !hasPattern,
    showDeviceChip: targetDeviceUuid.length > 0,
    toolbarChipText: targetDeviceUuid,
    uploadAreaMode: 'upload' as const,
    uploadAreaClassName: 'upload-area',
    uploadAreaIcon: '+',
    uploadAreaText: '点击上传图片',
    uploadAreaHint: 'JPG, PNG, GIF, WEBP (最大 20MB)',
    showExampleGallery: !hasPattern,
    showColorPanel: (input.colorSummaryCount ?? 0) > 0,
    showRnCapabilityHint: input.env === 'rn'
  }
}
