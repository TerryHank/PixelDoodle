export type ImageImportMode = 'pixel-art' | 'photo'

export interface ImageImportPlan {
  canvasWidth: number
  canvasHeight: number
  imageSmoothingEnabled: boolean
  mimeType: 'image/png' | 'image/jpeg'
  extension: 'png' | 'jpg'
  confirmLabel: string
  hint: string
}

function positiveDimension(value: number) {
  return Math.max(1, Math.round(value))
}

export function buildImageImportPlan(
  mode: ImageImportMode,
  cropWidth: number,
  cropHeight: number,
  gridWidth: number,
  gridHeight: number
): ImageImportPlan {
  if (mode === 'pixel-art') {
    return {
      canvasWidth: positiveDimension(gridWidth),
      canvasHeight: positiveDimension(gridHeight),
      imageSmoothingEnabled: false,
      mimeType: 'image/png',
      extension: 'png',
      confirmLabel: '开始识别',
      hint: '像素画模式：先校准网格和裁剪范围，再识别色号。'
    }
  }

  return {
    canvasWidth: positiveDimension(cropWidth),
    canvasHeight: positiveDimension(cropHeight),
    imageSmoothingEnabled: true,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    confirmLabel: '开始创作',
    hint: '照片模式：钉板豆数决定分辨率，画布固定并将图案等比居中。'
  }
}
