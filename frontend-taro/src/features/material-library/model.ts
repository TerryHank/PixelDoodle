import {
  buildPixelColorSummary,
  countPlacedBeads,
  createEmptyPixelMatrix
} from '@/features/pixel-editor/model'
import type { GridSize, PaletteColor, PixelMatrix } from '@/types/api'
import type {
  BuildMaterialPatternImportOptions,
  MaterialColorMapping,
  MaterialGalleryWork,
  MaterialPatternImportPayload
} from '@/types/material-library'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const GRID_PATTERN = /^(?:[0-9a-f]{2})+$/i

export const MATERIAL_SOURCE_OPTIONS = [
  { value: 'kandipad', label: 'KandiPad' },
  { value: 'pindou-fun', label: 'Like拼豆' },
  { value: 'pindou-io', label: '拼豆.io' },
  { value: 'pindoule', label: '拼豆了' },
  { value: 'beadshub', label: '拼豆集 BeadsHub' }
] as const

export const MATERIAL_CATEGORY_OPTIONS = [
  '宝可梦',
  '动漫',
  '游戏',
  '卡通',
  '影视',
  '动物',
  '节日',
  '食物',
  '植物自然',
  '文字标志',
  '人物',
  '其他'
] as const

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`素材 ${field} 必须是正整数`)
  }
  return value
}

function parseHexColor(hex: string): [number, number, number] {
  if (!HEX_COLOR_PATTERN.test(hex)) {
    throw new Error(`素材色值无效：${hex}`)
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ]
}

export function validateMaterialGalleryWork(work: MaterialGalleryWork) {
  positiveInteger(work.id, 'ID')
  positiveInteger(work.width, '宽度')
  positiveInteger(work.height, '高度')

  if (work.v !== 1 && work.v !== 2) {
    throw new Error('素材数据版本不受支持')
  }
  if (work.access !== 'public') {
    throw new Error('仅支持公开素材')
  }
  if (!work.title.trim()) {
    throw new Error('素材标题不能为空')
  }
  if (work.palette.length === 0 || work.palette.length > 255) {
    throw new Error('素材色盘数量必须在 1 到 255 之间')
  }
  if (work.palette.length !== work.keys.length) {
    throw new Error('素材 palette 与 keys 数量不一致')
  }
  work.palette.forEach(parseHexColor)

  const expectedLength = work.width * work.height * 2
  if (work.grid.length !== expectedLength || !GRID_PATTERN.test(work.grid)) {
    throw new Error(`素材 grid 长度或编码无效，应为 ${expectedLength} 个十六进制字符`)
  }
}

export function decodeMaterialPaletteIndices(work: MaterialGalleryWork) {
  validateMaterialGalleryWork(work)
  const matrix: Array<Array<number | null>> = []

  for (let y = 0; y < work.height; y += 1) {
    const row: Array<number | null> = []
    for (let x = 0; x < work.width; x += 1) {
      const offset = (y * work.width + x) * 2
      const paletteIndex = Number.parseInt(work.grid.slice(offset, offset + 2), 16)
      row.push(
        paletteIndex === 0xff || paletteIndex >= work.palette.length
          ? null
          : paletteIndex
      )
    }
    matrix.push(row)
  }

  return matrix
}

function colorDistance(
  left: [number, number, number],
  right: [number, number, number]
) {
  const red = left[0] - right[0]
  const green = left[1] - right[1]
  const blue = left[2] - right[2]
  return red * red + green * green + blue * blue
}

function mapMaterialColors(work: MaterialGalleryWork, colors: PaletteColor[]) {
  if (colors.length === 0) {
    throw new Error('专业拼豆调色板尚未加载')
  }

  const mappings: MaterialColorMapping[] = work.palette.map((sourceHex, index) => {
    const sourceRgb = parseHexColor(sourceHex)
    let closest = colors[0]
    let closestDistance = colorDistance(sourceRgb, closest.rgb)

    for (let colorIndex = 1; colorIndex < colors.length; colorIndex += 1) {
      const candidate = colors[colorIndex]
      const distance = colorDistance(sourceRgb, candidate.rgb)
      if (distance < closestDistance) {
        closest = candidate
        closestDistance = distance
      }
    }

    return {
      sourceHex,
      sourceKey: work.keys[index],
      targetCode: closest.code
    }
  })

  return mappings
}

export function fitPixelMatrixToBoard(matrix: PixelMatrix, boardSize: GridSize) {
  const targetWidth = positiveInteger(Math.round(boardSize.width), '目标宽度')
  const targetHeight = positiveInteger(Math.round(boardSize.height), '目标高度')
  const sourceHeight = matrix.length
  const sourceWidth = matrix[0]?.length ?? 0

  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    !matrix.every((row) => row.length === sourceWidth)
  ) {
    throw new Error('素材像素矩阵为空或行宽不一致')
  }

  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return matrix.map((row) => [...row])
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const fittedWidth = Math.min(
    targetWidth,
    Math.max(1, Math.round(sourceWidth * scale))
  )
  const fittedHeight = Math.min(
    targetHeight,
    Math.max(1, Math.round(sourceHeight * scale))
  )
  const offsetX = Math.floor((targetWidth - fittedWidth) / 2)
  const offsetY = Math.floor((targetHeight - fittedHeight) / 2)
  const result = createEmptyPixelMatrix(targetWidth, targetHeight)

  for (let y = 0; y < fittedHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / fittedHeight))
    for (let x = 0; x < fittedWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / fittedWidth))
      result[offsetY + y][offsetX + x] = matrix[sourceY][sourceX]
    }
  }

  return result
}

export function buildMaterialPatternImport(
  work: MaterialGalleryWork,
  options: BuildMaterialPatternImportOptions
): MaterialPatternImportPayload {
  const paletteIndices = decodeMaterialPaletteIndices(work)
  const colorMapping = mapMaterialColors(work, options.colors)
  const sourceMatrix = paletteIndices.map((row) =>
    row.map((paletteIndex) =>
      paletteIndex === null ? null : colorMapping[paletteIndex].targetCode
    )
  )
  const pixelMatrix = fitPixelMatrixToBoard(sourceMatrix, options.boardSize)
  const createdAt = options.createdAt ?? new Date().toISOString()

  return {
    version: 1,
    kind: 'material-library',
    importId: `material-${work.source}-${work.id}-${Date.parse(createdAt) || Date.now()}`,
    createdAt,
    title: work.title.trim(),
    material: {
      id: work.id,
      source: work.source,
      category: work.category,
      tags: [...work.tags],
      originalSize: {
        width: work.width,
        height: work.height
      }
    },
    boardSize: {
      width: Math.round(options.boardSize.width),
      height: Math.round(options.boardSize.height)
    },
    palettePreset: options.palettePreset,
    pixelMatrix,
    colorSummary: buildPixelColorSummary(pixelMatrix, options.colors),
    totalBeads: countPlacedBeads(pixelMatrix),
    colorMapping
  }
}

export function getMaterialSourceLabel(source: string) {
  return MATERIAL_SOURCE_OPTIONS.find((item) => item.value === source)?.label ?? source
}
