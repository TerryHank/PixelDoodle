export interface CanvasRenderCell {
  x: number
  y: number
  code: string | null
  masked: boolean
}

export interface CanvasRenderModel {
  cellSize: number
  canvasWidth: number
  canvasHeight: number
  cells: CanvasRenderCell[]
}

export function buildCanvasRenderModel(input: {
  gridWidth: number
  gridHeight: number
  activeCodes: Set<string>
  pixelMatrix: (string | null)[][]
  maxPatternDim?: number
}): CanvasRenderModel {
  const width = Math.max(1, input.gridWidth)
  const height = Math.max(1, input.gridHeight)
  const maxPatternDim = Math.max(
    1,
    Math.floor(input.maxPatternDim ?? 640)
  )
  const cellSize = Math.max(
    2,
    Math.min(
      Math.floor(maxPatternDim / width),
      Math.floor(maxPatternDim / height)
    )
  )

  const cells: CanvasRenderCell[] = []

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const code = input.pixelMatrix[y]?.[x] ?? null
      cells.push({
        x,
        y,
        code,
        masked:
          code !== null &&
          input.activeCodes.size > 0 &&
          !input.activeCodes.has(code)
      })
    }
  }

  return {
    cellSize,
    canvasWidth: width * cellSize,
    canvasHeight: height * cellSize,
    cells
  }
}

export function drawCanvasRenderModel(input: {
  context: CanvasRenderingContext2D
  model: CanvasRenderModel
  colorLookup: Record<string, string>
}) {
  const { context, model, colorLookup } = input
  const cs = model.cellSize

  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, model.canvasWidth, model.canvasHeight)

  model.cells.forEach((cell) => {
    const cellX = cell.x * cs
    const cellY = cell.y * cs

    if (cell.code === null) {
      const blockSize = Math.max(2, Math.floor(cs / 4))
      for (let by = 0; by < cs; by += blockSize) {
        for (let bx = 0; bx < cs; bx += blockSize) {
          const ix = Math.floor(bx / blockSize)
          const iy = Math.floor(by / blockSize)
          context.fillStyle = (ix + iy) % 2 === 0 ? '#DCDCDC' : '#B4B4B4'
          context.fillRect(
            cellX + bx,
            cellY + by,
            Math.min(blockSize, cs - bx),
            Math.min(blockSize, cs - by)
          )
        }
      }
      return
    }

    context.fillStyle = colorLookup[cell.code] ?? '#FFFFFF'
    context.fillRect(cellX, cellY, cs, cs)

    if (cell.masked) {
      context.fillStyle = 'rgba(255, 255, 255, 0.72)'
      context.fillRect(cellX, cellY, cs, cs)
    }
  })

  if (cs < 4) {
    return
  }

  const gridWidth = model.canvasWidth / cs
  const gridHeight = model.canvasHeight / cs
  context.strokeStyle = 'rgba(0, 0, 0, 0.1)'
  context.lineWidth = 0.5

  for (let x = 0; x <= gridWidth; x += 1) {
    context.beginPath()
    context.moveTo(x * cs, 0)
    context.lineTo(x * cs, model.canvasHeight)
    context.stroke()
  }

  for (let y = 0; y <= gridHeight; y += 1) {
    context.beginPath()
    context.moveTo(0, y * cs)
    context.lineTo(model.canvasWidth, y * cs)
    context.stroke()
  }
}

export function formatColorTotalText(colors: number, beads: number) {
  return `${colors} 种颜色, 共 ${beads} 颗珠子`
}
