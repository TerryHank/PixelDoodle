import type {
  ColorSummaryItem,
  PaletteColor,
  PalettePresetMap,
  PixelMatrix
} from '@/types/api'

export interface BoardSizeOption {
  id: string
  label: string
  width: number
  height: number
}

export const BOARD_SIZE_OPTIONS: BoardSizeOption[] = [
  { id: '29x29', label: '29 × 29', width: 29, height: 29 },
  { id: '32x32', label: '32 × 32', width: 32, height: 32 },
  { id: '52x52', label: '52 × 52', width: 52, height: 52 },
  { id: '78x78', label: '78 × 78', width: 78, height: 78 },
  { id: '104x104', label: '104 × 104', width: 104, height: 104 },
  { id: '104x74', label: '104 × 74', width: 104, height: 74 }
]

export function getBoardSize(id: string) {
  return BOARD_SIZE_OPTIONS.find((option) => option.id === id) ?? BOARD_SIZE_OPTIONS[0]
}

export function createEmptyPixelMatrix(width: number, height: number): PixelMatrix {
  return Array.from({ length: Math.max(1, Math.round(height)) }, () =>
    Array.from({ length: Math.max(1, Math.round(width)) }, () => null)
  )
}

export function clonePixelMatrix(matrix: PixelMatrix): PixelMatrix {
  return matrix.map((row) => [...row])
}

export function mirrorPixelMatrixHorizontally(matrix: PixelMatrix): PixelMatrix {
  return matrix.map((row) => [...row].reverse())
}

export function rotatePixelMatrixClockwise(matrix: PixelMatrix): PixelMatrix {
  const height = matrix.length
  const width = matrix[0]?.length ?? 0
  if (height === 0 || width === 0 || matrix.some((row) => row.length !== width)) {
    return clonePixelMatrix(matrix)
  }

  return Array.from({ length: width }, (_, y) =>
    Array.from({ length: height }, (_, x) => matrix[height - 1 - x][y])
  )
}

export function matricesEqual(left: PixelMatrix, right: PixelMatrix) {
  if (left.length !== right.length) {
    return false
  }

  for (let y = 0; y < left.length; y += 1) {
    if (left[y].length !== right[y].length) {
      return false
    }

    for (let x = 0; x < left[y].length; x += 1) {
      if (left[y][x] !== right[y][x]) {
        return false
      }
    }
  }

  return true
}

export function setPixelCell(
  matrix: PixelMatrix,
  x: number,
  y: number,
  code: string | null
) {
  if (y < 0 || y >= matrix.length || x < 0 || x >= (matrix[y]?.length ?? 0)) {
    return matrix
  }

  if (matrix[y][x] === code) {
    return matrix
  }

  const next = [...matrix]
  next[y] = [...matrix[y]]
  next[y][x] = code
  return next
}

export function rasterizeGridLine(
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const cells: Array<{ x: number; y: number }> = []
  let x = start.x
  let y = start.y
  const deltaX = Math.abs(end.x - start.x)
  const deltaY = Math.abs(end.y - start.y)
  const stepX = start.x < end.x ? 1 : -1
  const stepY = start.y < end.y ? 1 : -1
  let error = deltaX - deltaY

  while (true) {
    cells.push({ x, y })
    if (x === end.x && y === end.y) break
    const doubledError = error * 2
    if (doubledError > -deltaY) {
      error -= deltaY
      x += stepX
    }
    if (doubledError < deltaX) {
      error += deltaX
      y += stepY
    }
  }

  return cells
}

export function floodFillPixelMatrix(
  matrix: PixelMatrix,
  startX: number,
  startY: number,
  replacement: string | null
) {
  const target = matrix[startY]?.[startX]
  if (target === undefined || target === replacement) {
    return matrix
  }

  const next = clonePixelMatrix(matrix)
  const queue: Array<[number, number]> = [[startX, startY]]
  let cursor = 0

  while (cursor < queue.length) {
    const [x, y] = queue[cursor]
    cursor += 1

    if (next[y]?.[x] !== target) {
      continue
    }

    next[y][x] = replacement

    if (x > 0) queue.push([x - 1, y])
    if (x + 1 < next[y].length) queue.push([x + 1, y])
    if (y > 0) queue.push([x, y - 1])
    if (y + 1 < next.length) queue.push([x, y + 1])
  }

  return next
}

function colorDistance(left: PaletteColor, right: PaletteColor) {
  const red = left.rgb[0] - right.rgb[0]
  const green = left.rgb[1] - right.rgb[1]
  const blue = left.rgb[2] - right.rgb[2]
  return red * red + green * green + blue * blue
}

export function getPresetColors(
  colors: PaletteColor[],
  presets: PalettePresetMap,
  presetKey: string
) {
  const allowedCodes = presets[presetKey]?.codes
  if (!allowedCodes) {
    return colors
  }

  const allowed = new Set(allowedCodes)
  return colors.filter((color) => allowed.has(color.code))
}

export function applyPaletteToPixelMatrix(
  matrix: PixelMatrix,
  colors: PaletteColor[],
  presets: PalettePresetMap,
  presetKey: string
) {
  const paletteByCode = new Map(colors.map((color) => [color.code, color]))
  const candidates = getPresetColors(colors, presets, presetKey)
  const candidateCodes = new Set(candidates.map((color) => color.code))
  const replacements = new Map<string, string>()

  if (candidates.length === 0) {
    return clonePixelMatrix(matrix)
  }

  return matrix.map((row) =>
    row.map((code) => {
      if (!code || candidateCodes.has(code)) {
        return code
      }

      const cached = replacements.get(code)
      if (cached) {
        return cached
      }

      const source = paletteByCode.get(code)
      if (!source) {
        return code
      }

      let closest = candidates[0]
      let closestDistance = colorDistance(source, closest)

      for (let index = 1; index < candidates.length; index += 1) {
        const distance = colorDistance(source, candidates[index])
        if (distance < closestDistance) {
          closest = candidates[index]
          closestDistance = distance
        }
      }

      replacements.set(code, closest.code)
      return closest.code
    })
  )
}

export function resizePixelMatrix(
  matrix: PixelMatrix,
  width: number,
  height: number
) {
  const next = createEmptyPixelMatrix(width, height)
  const sourceWidth = matrix[0]?.length ?? 0
  const sourceHeight = matrix.length
  const copyWidth = Math.min(sourceWidth, width)
  const copyHeight = Math.min(sourceHeight, height)
  const sourceX = Math.max(0, Math.floor((sourceWidth - copyWidth) / 2))
  const sourceY = Math.max(0, Math.floor((sourceHeight - copyHeight) / 2))
  const targetX = Math.max(0, Math.floor((width - copyWidth) / 2))
  const targetY = Math.max(0, Math.floor((height - copyHeight) / 2))

  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      next[targetY + y][targetX + x] = matrix[sourceY + y][sourceX + x]
    }
  }

  return next
}

export function buildPixelColorSummary(
  matrix: PixelMatrix,
  colors: PaletteColor[]
) {
  const counts = new Map<string, number>()
  matrix.forEach((row) => {
    row.forEach((code) => {
      if (code) {
        counts.set(code, (counts.get(code) ?? 0) + 1)
      }
    })
  })

  const byCode = new Map(colors.map((color) => [color.code, color]))
  const summary: ColorSummaryItem[] = []

  counts.forEach((count, code) => {
    const color = byCode.get(code)
    if (color) {
      summary.push({ ...color, count })
    }
  })

  return summary.sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
}

export function countPlacedBeads(matrix: PixelMatrix) {
  return matrix.reduce(
    (total, row) => total + row.filter((code) => code !== null).length,
    0
  )
}
