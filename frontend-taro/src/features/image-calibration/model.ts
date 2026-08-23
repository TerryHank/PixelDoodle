export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

function normalizeGridDimension(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
}

export function getCalibrationGridBackgroundSize(
  gridWidth: number,
  gridHeight: number
) {
  const columns = normalizeGridDimension(gridWidth)
  const rows = normalizeGridDimension(gridHeight)
  return `calc(100% / ${columns}) calc(100% / ${rows})`
}

export function createAspectCropRect(
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number
): CropRect {
  const safeImageWidth = Math.max(1, imageWidth)
  const safeImageHeight = Math.max(1, imageHeight)
  const targetRatio = Math.max(1, targetWidth) / Math.max(1, targetHeight)
  const imageRatio = safeImageWidth / safeImageHeight
  const width = imageRatio > targetRatio
    ? safeImageHeight * targetRatio
    : safeImageWidth
  const height = imageRatio > targetRatio
    ? safeImageHeight
    : safeImageWidth / targetRatio

  return {
    x: (safeImageWidth - width) / 2,
    y: (safeImageHeight - height) / 2,
    width,
    height
  }
}

export function zoomCropRect(
  baseRect: CropRect,
  currentRect: CropRect,
  imageWidth: number,
  imageHeight: number,
  zoom: number
) {
  const safeZoom = Math.max(1, zoom)
  const width = baseRect.width / safeZoom
  const height = baseRect.height / safeZoom
  const centerX = currentRect.x + currentRect.width / 2
  const centerY = currentRect.y + currentRect.height / 2

  return clampCropRect(
    {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height
    },
    imageWidth,
    imageHeight
  )
}

export function clampCropRect(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number
): CropRect {
  const width = Math.min(Math.max(1, rect.width), Math.max(1, imageWidth))
  const height = Math.min(Math.max(1, rect.height), Math.max(1, imageHeight))

  return {
    x: Math.max(0, Math.min(rect.x, imageWidth - width)),
    y: Math.max(0, Math.min(rect.y, imageHeight - height)),
    width,
    height
  }
}
