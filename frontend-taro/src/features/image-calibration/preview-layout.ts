export interface FixedBoardPreviewLayout {
  bitmapSize: number
  boardWidth: number
  boardHeight: number
  cellSize: number
  offsetX: number
  offsetY: number
}

function normalizeDimension(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
}

export function buildFixedBoardPreviewLayout(
  boardWidth: number,
  boardHeight: number,
  bitmapSize = 624
): FixedBoardPreviewLayout {
  const width = normalizeDimension(boardWidth)
  const height = normalizeDimension(boardHeight)
  const size = normalizeDimension(bitmapSize)
  const cellSize = size / Math.max(width, height)

  return {
    bitmapSize: size,
    boardWidth: width,
    boardHeight: height,
    cellSize,
    offsetX: (size - width * cellSize) / 2,
    offsetY: (size - height * cellSize) / 2
  }
}
