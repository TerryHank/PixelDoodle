import type {
  ColorSummaryItem,
  GeneratePatternResponse,
  PaletteColor,
  PalettePresetMap
} from '@/types/api'

import type { LocalGenerateOptions } from './local-generation'
import type { WeappImageRaster } from './weapp-raster-loader'

type Lab = [number, number, number]

interface PaletteState {
  colors: PaletteColor[]
  presets: PalettePresetMap
  labValues: Lab[]
  codeToIndex: Map<string, number>
}

interface GeneratePatternLocalJsInput {
  sourceWidth: number
  sourceHeight: number
  selectionRaster: WeappImageRaster
  midRaster: WeappImageRaster
  options: LocalGenerateOptions
  colors: PaletteColor[]
  presets: PalettePresetMap
}

function linearize(channel: number): number {
  return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92
}

function xyzToLab([x, y, z]: [number, number, number]): Lab {
  const white: [number, number, number] = [0.95047, 1, 1.08883]
  const delta = 6 / 29
  const delta3 = delta * delta * delta
  const f = (value: number) =>
    value > delta3 ? Math.cbrt(value) : value / (3 * delta * delta) + 4 / 29

  const fx = f(x / white[0])
  const fy = f(y / white[1])
  const fz = f(z / white[2])

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function rgbToLab(rgb: [number, number, number]): Lab {
  const r = linearize(rgb[0] / 255)
  const g = linearize(rgb[1] / 255)
  const b = linearize(rgb[2] / 255)
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041
  return xyzToLab([x, y, z])
}

function labDistance(lhs: Lab, rhs: Lab): number {
  const dl = lhs[0] - rhs[0]
  const da = lhs[1] - rhs[1]
  const db = lhs[2] - rhs[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function grayscale(rgb: [number, number, number]): number {
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
}

export function resolveLocalGridSize(
  width: number,
  height: number,
  options: LocalGenerateOptions
) {
  if (options.mode === 'pixel_size') {
    return {
      width: Math.max(16, Math.round(width / Math.max(options.pixel_size || 8, 1))),
      height: Math.max(16, Math.round(height / Math.max(options.pixel_size || 8, 1)))
    }
  }

  return {
    width: Math.max(1, options.grid_width || 48),
    height: Math.max(1, options.grid_height || 48)
  }
}

function cloneRaster(raster: WeappImageRaster): WeappImageRaster {
  return {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data)
  }
}

function applyContrast(raster: WeappImageRaster, amount: number) {
  if (!amount) {
    return
  }

  const factor = 1 + amount / 100
  const { data } = raster
  let mean = 127
  let accum = 0

  for (let index = 0; index < data.length; index += 4) {
    accum += grayscale([data[index], data[index + 1], data[index + 2]])
  }

  mean = accum / (data.length / 4)

  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampByte(mean + (data[index] - mean) * factor)
    data[index + 1] = clampByte(mean + (data[index + 1] - mean) * factor)
    data[index + 2] = clampByte(mean + (data[index + 2] - mean) * factor)
  }
}

function applySaturation(raster: WeappImageRaster, amount: number) {
  if (!amount) {
    return
  }

  const factor = 1 + amount / 100
  const { data } = raster

  for (let index = 0; index < data.length; index += 4) {
    const gray = grayscale([data[index], data[index + 1], data[index + 2]])
    data[index] = clampByte(gray + (data[index] - gray) * factor)
    data[index + 1] = clampByte(gray + (data[index + 1] - gray) * factor)
    data[index + 2] = clampByte(gray + (data[index + 2] - gray) * factor)
  }
}

function applySharpness(raster: WeappImageRaster, amount: number) {
  if (!amount) {
    return
  }

  const { width, height, data } = raster
  const source = new Uint8ClampedArray(data)
  const alpha = Math.max(0, amount / 100)

  const sample = (x: number, y: number, channel: number) => {
    const safeX = Math.max(0, Math.min(width - 1, x))
    const safeY = Math.max(0, Math.min(height - 1, y))
    return source[(safeY * width + safeX) * 4 + channel]
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4

      for (let channel = 0; channel < 3; channel += 1) {
        const center = sample(x, y, channel) * 5
        const blurred =
          sample(x - 1, y, channel) +
          sample(x + 1, y, channel) +
          sample(x, y - 1, channel) +
          sample(x, y + 1, channel)
        const sharpened = center - blurred
        data[offset + channel] = clampByte(
          source[offset + channel] * (1 - alpha) + sharpened * alpha
        )
      }
    }
  }
}

function rasterToPixels(raster: WeappImageRaster): [number, number, number][] {
  const pixels: [number, number, number][] = []

  for (let index = 0; index < raster.data.length; index += 4) {
    pixels.push([
      raster.data[index],
      raster.data[index + 1],
      raster.data[index + 2]
    ])
  }

  return pixels
}

function estimateColorCount(
  pixels: [number, number, number][],
  width: number,
  height: number
) {
  if (pixels.length === 0) {
    return 12
  }

  const means = [0, 0, 0]
  for (const rgb of pixels) {
    means[0] += rgb[0]
    means[1] += rgb[1]
    means[2] += rgb[2]
  }

  means[0] /= pixels.length
  means[1] /= pixels.length
  means[2] /= pixels.length

  let totalVariance = 0
  for (const rgb of pixels) {
    totalVariance +=
      ((rgb[0] - means[0]) ** 2 +
        (rgb[1] - means[1]) ** 2 +
        (rgb[2] - means[2]) ** 2) /
      pixels.length
  }

  let count = Math.round(12 + ((totalVariance - 500) * 28) / 3500)
  count = Math.max(12, Math.min(40, count))

  const area = width * height
  if (area > 48 * 48) {
    count = Math.min(40, count + 5)
  }
  if (area < 29 * 29) {
    count = Math.max(12, count - 3)
  }

  return count
}

function buildPaletteState(colors: PaletteColor[], presets: PalettePresetMap): PaletteState {
  return {
    colors,
    presets,
    labValues: colors.map((item) => rgbToLab(item.rgb)),
    codeToIndex: new Map(colors.map((item, index) => [item.code, index]))
  }
}

function allowedPaletteIndices(
  state: PaletteState,
  presetKey: string
): number[] | null {
  const preset = state.presets[presetKey]
  if (!preset || !preset.codes) {
    return null
  }

  return preset.codes
    .map((code) => state.codeToIndex.get(code))
    .filter((index): index is number => typeof index === 'number')
    .sort((lhs, rhs) => lhs - rhs)
}

function closestPaletteIndex(
  rgb: [number, number, number],
  state: PaletteState,
  allowed: number[] | null
) {
  const lab = rgbToLab(rgb)
  const candidates = allowed ?? state.colors.map((_, index) => index)
  let bestIndex = candidates[0] ?? 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (const index of candidates) {
    const distance = labDistance(lab, state.labValues[index])
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function selectTopColors(
  pixels: [number, number, number][],
  state: PaletteState,
  allowed: number[] | null,
  limit: number
) {
  const counts = new Map<number, number>()

  for (const pixel of pixels) {
    const index = closestPaletteIndex(pixel, state, allowed)
    counts.set(index, (counts.get(index) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((lhs, rhs) => rhs[1] - lhs[1] || rhs[0] - lhs[0])
    .slice(0, limit)
    .map(([index]) => index)
    .sort((lhs, rhs) => lhs - rhs)
}

function packRgbKey(rgb: [number, number, number]) {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
}

function reduceRgbForPaletteLookup(
  rgb: [number, number, number]
): [number, number, number] {
  return [rgb[0] & ~0b11, rgb[1] & ~0b11, rgb[2] & ~0b11]
}

function rgbDistanceSquared(
  lhs: [number, number, number],
  rhs: [number, number, number]
) {
  const dr = lhs[0] - rhs[0]
  const dg = lhs[1] - rhs[1]
  const db = lhs[2] - rhs[2]
  return dr * dr + dg * dg + db * db
}

function createSubPaletteMatcher(colors: PaletteColor[]) {
  const cache = new Map<number, number>()

  return (rgb: [number, number, number]) => {
    const reduced = reduceRgbForPaletteLookup(rgb)
    const key = packRgbKey(reduced)
    const cached = cache.get(key)
    if (typeof cached === 'number') {
      return cached
    }

    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < colors.length; index += 1) {
      const distance = rgbDistanceSquared(reduced, colors[index].rgb)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }

    cache.set(key, bestIndex)
    return bestIndex
  }
}

function quantizePixels(
  raster: WeappImageRaster,
  subPalette: PaletteColor[],
  dithering: boolean
) {
  const { width, height, data } = raster
  const working = new Float64Array(width * height * 3)
  const closestSubpaletteIndex = createSubPaletteMatcher(subPalette)

  for (let rgbaIndex = 0, rgbIndex = 0; rgbaIndex < data.length; rgbaIndex += 4, rgbIndex += 3) {
    working[rgbIndex] = data[rgbaIndex]
    working[rgbIndex + 1] = data[rgbaIndex + 1]
    working[rgbIndex + 2] = data[rgbaIndex + 2]
  }

  const result = new Array<number>(width * height)

  const diffuse = (
    x: number,
    y: number,
    error: [number, number, number],
    weight: number
  ) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return
    }

    const offset = (y * width + x) * 3
    working[offset] += error[0] * weight
    working[offset + 1] += error[1] * weight
    working[offset + 2] += error[2] * weight
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const oldPixel: [number, number, number] = [
        clampByte(working[offset]),
        clampByte(working[offset + 1]),
        clampByte(working[offset + 2])
      ]
      const localIndex = closestSubpaletteIndex(oldPixel, subPalette)
      result[y * width + x] = localIndex

      if (!dithering) {
        continue
      }

      const nextRgb = subPalette[localIndex].rgb
      const error: [number, number, number] = [
        oldPixel[0] - nextRgb[0],
        oldPixel[1] - nextRgb[1],
        oldPixel[2] - nextRgb[2]
      ]

      diffuse(x + 1, y, error, 7 / 16)
      diffuse(x - 1, y + 1, error, 3 / 16)
      diffuse(x, y + 1, error, 5 / 16)
      diffuse(x + 1, y + 1, error, 1 / 16)
    }
  }

  return result
}

function poolToMatrix(
  quantized: number[],
  subPaletteIndices: number[],
  gridWidth: number,
  gridHeight: number
) {
  const matrix: (number | null)[][] = []
  const pooledWidth = gridWidth * 4

  for (let y = 0; y < gridHeight; y += 1) {
    const row: (number | null)[] = []

    for (let x = 0; x < gridWidth; x += 1) {
      const counts = new Map<number, number>()

      for (let sampleY = 0; sampleY < 4; sampleY += 1) {
        for (let sampleX = 0; sampleX < 4; sampleX += 1) {
          const pooledIndex = (y * 4 + sampleY) * pooledWidth + (x * 4 + sampleX)
          const localIndex = quantized[pooledIndex]
          counts.set(localIndex, (counts.get(localIndex) ?? 0) + 1)
        }
      }

      const winner = [...counts.entries()].sort(
        (lhs, rhs) => rhs[1] - lhs[1] || lhs[0] - rhs[0]
      )[0]

      row.push(winner ? subPaletteIndices[winner[0]] : null)
    }

    matrix.push(row)
  }

  return matrix
}

function applyRemap(
  matrix: (number | null)[][],
  remap: Map<number, number>
) {
  if (remap.size === 0) {
    return
  }

  for (const row of matrix) {
    for (let index = 0; index < row.length; index += 1) {
      const value = row[index]
      if (value === null) {
        continue
      }
      const next = remap.get(value)
      if (typeof next === 'number') {
        row[index] = next
      }
    }
  }
}

function collectNeighbors(
  matrix: (number | null)[][],
  x: number,
  y: number
) {
  const neighbors: number[] = []
  const height = matrix.length
  const width = matrix[0]?.length ?? 0

  if (y > 0 && matrix[y - 1][x] !== null) {
    neighbors.push(matrix[y - 1][x] as number)
  }
  if (y + 1 < height && matrix[y + 1][x] !== null) {
    neighbors.push(matrix[y + 1][x] as number)
  }
  if (x > 0 && matrix[y][x - 1] !== null) {
    neighbors.push(matrix[y][x - 1] as number)
  }
  if (x + 1 < width && matrix[y][x + 1] !== null) {
    neighbors.push(matrix[y][x + 1] as number)
  }

  return neighbors
}

function mostCommonNeighbor(values: number[]) {
  const counts = new Map<number, number>()
  const firstSeen = new Map<number, number>()

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    counts.set(value, (counts.get(value) ?? 0) + 1)
    if (!firstSeen.has(value)) {
      firstSeen.set(value, index)
    }
  }

  return [...counts.entries()]
    .sort((lhs, rhs) => {
      const countDelta = rhs[1] - lhs[1]
      if (countDelta !== 0) {
        return countDelta
      }

      return (
        (firstSeen.get(lhs[0]) ?? Number.MAX_SAFE_INTEGER) -
        (firstSeen.get(rhs[0]) ?? Number.MAX_SAFE_INTEGER)
      )
    })[0]?.[0] ?? values[0]
}

function cleanupRareColors(
  matrix: (number | null)[][],
  state: PaletteState,
  totalPixels: number,
  minRatio: number
) {
  const frequencies = new Map<number, number>()

  for (const row of matrix) {
    for (const value of row) {
      if (value !== null) {
        frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
      }
    }
  }

  const minCount = Math.max(2, Math.floor(totalPixels * minRatio))
  const kept = [...frequencies.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([value]) => value)

  if (kept.length === 0) {
    return
  }

  const keptSet = new Set(kept)
  const remap = new Map<number, number>()

  for (const rare of frequencies.keys()) {
    if (keptSet.has(rare)) {
      continue
    }

    let replacement = kept[0]
    let bestDistance = Number.POSITIVE_INFINITY

    for (const candidate of kept) {
      const distance = labDistance(state.labValues[rare], state.labValues[candidate])
      if (distance < bestDistance) {
        bestDistance = distance
        replacement = candidate
      }
    }

    remap.set(rare, replacement)
  }

  applyRemap(matrix, remap)
}

function mergeSimilarColors(
  matrix: (number | null)[][],
  state: PaletteState,
  threshold: number
) {
  const frequencies = new Map<number, number>()

  for (const row of matrix) {
    for (const value of row) {
      if (value !== null) {
        frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
      }
    }
  }

  const ordered = [...frequencies.entries()]
    .sort((lhs, rhs) => rhs[1] - lhs[1] || lhs[0] - rhs[0])
    .map(([value]) => value)

  const replaced = new Set<number>()
  const remap = new Map<number, number>()

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]
    if (replaced.has(current)) {
      continue
    }

    for (let lowerIndex = index + 1; lowerIndex < ordered.length; lowerIndex += 1) {
      const lower = ordered[lowerIndex]
      if (replaced.has(lower)) {
        continue
      }

      if (labDistance(state.labValues[current], state.labValues[lower]) < threshold) {
        replaced.add(lower)
        remap.set(lower, current)
      }
    }
  }

  applyRemap(matrix, remap)
}

function capMaxColors(
  matrix: (number | null)[][],
  state: PaletteState,
  maxColors: number
) {
  const frequencies = new Map<number, number>()

  for (const row of matrix) {
    for (const value of row) {
      if (value !== null) {
        frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
      }
    }
  }

  if (frequencies.size <= maxColors) {
    return
  }

  const ranked = [...frequencies.entries()].sort(
    (lhs, rhs) => rhs[1] - lhs[1] || lhs[0] - rhs[0]
  )
  const kept = ranked.slice(0, maxColors).map(([value]) => value)
  const remap = new Map<number, number>()

  for (const [removed] of ranked.slice(maxColors)) {
    let replacement = kept[0]
    let bestDistance = Number.POSITIVE_INFINITY

    for (const candidate of kept) {
      const distance = labDistance(state.labValues[removed], state.labValues[candidate])
      if (distance < bestDistance) {
        bestDistance = distance
        replacement = candidate
      }
    }

    remap.set(removed, replacement)
  }

  applyRemap(matrix, remap)
}

function smoothEdges(matrix: (number | null)[][], state: PaletteState) {
  const snapshot = matrix.map((row) => [...row])
  const height = snapshot.length
  const width = snapshot[0]?.length ?? 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const current = snapshot[y][x]
      if (current === null) {
        continue
      }

      const neighbors = collectNeighbors(snapshot, x, y)
      if (neighbors.length === 0 || neighbors.some((value) => value === current)) {
        continue
      }

      const replacement = mostCommonNeighbor(neighbors)
      if (labDistance(state.labValues[current], state.labValues[replacement]) > 30) {
        continue
      }

      matrix[y][x] = replacement
    }
  }
}

function removeBackground(matrix: (number | null)[][]) {
  const height = matrix.length
  const width = matrix[0]?.length ?? 0
  if (!height || !width) {
    return
  }

  const corners = [
    matrix[0][0],
    matrix[0][width - 1],
    matrix[height - 1][0],
    matrix[height - 1][width - 1]
  ].filter((value): value is number => value !== null)

  if (!corners.length) {
    return
  }

  const background = [...corners
    .reduce((accumulator, value) => {
      accumulator.set(value, (accumulator.get(value) ?? 0) + 1)
      return accumulator
    }, new Map<number, number>())
    .entries()]
    .sort((lhs, rhs) => rhs[1] - lhs[1])[0]?.[0]

  if (typeof background !== 'number') {
    return
  }

  const queue: Array<[number, number]> = []
  const visited = new Set<string>()

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return
    }

    const key = `${x},${y}`
    if (visited.has(key) || matrix[y][x] !== background) {
      return
    }

    visited.add(key)
    queue.push([x, y])
  }

  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }

  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }

  while (queue.length) {
    const [x, y] = queue.shift()!
    matrix[y][x] = null
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
}

function renderMatrixAndSummary(
  matrix: (number | null)[][],
  colors: PaletteColor[]
): Pick<
  GeneratePatternResponse,
  'pixel_matrix' | 'color_summary' | 'total_beads'
> {
  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  const order: string[] = []
  let totalBeads = 0

  const pixelMatrix = matrix.map((row) =>
    row.map((index) => {
      if (index === null) {
        return null
      }

      const color = colors[index]
      if (!counts.has(color.code)) {
        firstSeen.set(color.code, order.length)
        order.push(color.code)
      }

      counts.set(color.code, (counts.get(color.code) ?? 0) + 1)
      totalBeads += 1
      return color.code
    })
  )

  const colorSummary: ColorSummaryItem[] = [...counts.entries()]
    .sort(
      (lhs, rhs) =>
        rhs[1] - lhs[1] ||
        (firstSeen.get(lhs[0]) ?? 0) - (firstSeen.get(rhs[0]) ?? 0)
    )
    .map(([code, count]) => {
      const color = colors.find((item) => item.code === code)!
      return {
        code,
        name: color.name,
        name_zh: color.name_zh,
        hex: color.hex,
        rgb: color.rgb,
        count
      }
    })

  return {
    pixel_matrix: pixelMatrix,
    color_summary: colorSummary,
    total_beads: totalBeads
  }
}

export const __localGenerationJsInternals = {
  buildPaletteState,
  cleanupRareColors,
  mergeSimilarColors,
  capMaxColors,
  smoothEdges,
  reduceRgbForPaletteLookup,
  rgbDistanceSquared
}

export function generatePatternLocalJs({
  sourceWidth,
  sourceHeight,
  selectionRaster,
  midRaster,
  options,
  colors,
  presets
}: GeneratePatternLocalJsInput): Pick<
  GeneratePatternResponse,
  'grid_size' | 'pixel_matrix' | 'color_summary' | 'total_beads' | 'preview_image'
> {
  const paletteState = buildPaletteState(colors, presets)
  const grid = resolveLocalGridSize(sourceWidth, sourceHeight, options)

  const adjustedSelection = cloneRaster(selectionRaster)
  applyContrast(adjustedSelection, options.contrast)
  applySaturation(adjustedSelection, options.saturation)
  applySharpness(adjustedSelection, options.sharpness)

  const selectionPixels = rasterToPixels(adjustedSelection)
  const allowed = allowedPaletteIndices(paletteState, options.palette_preset)
  const paletteLimit =
    options.max_colors > 0
      ? Math.min(options.max_colors, allowed?.length ?? colors.length)
      : estimateColorCount(selectionPixels, grid.width, grid.height)

  const subPaletteIndices = selectTopColors(
    selectionPixels,
    paletteState,
    allowed,
    paletteLimit
  )
  const subPalette = subPaletteIndices.map((index) => colors[index])

  const adjustedMid = cloneRaster(midRaster)
  applyContrast(adjustedMid, options.contrast)
  applySaturation(adjustedMid, options.saturation)
  applySharpness(adjustedMid, options.sharpness)

  const quantized = quantizePixels(
    adjustedMid,
    subPalette,
    options.use_dithering
  )
  const matrix = poolToMatrix(
    quantized,
    subPaletteIndices,
    grid.width,
    grid.height
  )
  const totalPixels = grid.width * grid.height

  cleanupRareColors(matrix, paletteState, totalPixels, 0.005)

  if (options.similarity_threshold > 0) {
    mergeSimilarColors(matrix, paletteState, options.similarity_threshold)
  }

  if (options.max_colors > 0) {
    capMaxColors(matrix, paletteState, options.max_colors)
  }

  smoothEdges(matrix, paletteState)

  if (options.remove_bg) {
    removeBackground(matrix)
  }

  const rendered = renderMatrixAndSummary(matrix, colors)

  return {
    grid_size: grid,
    pixel_matrix: rendered.pixel_matrix,
    color_summary: rendered.color_summary,
    total_beads: rendered.total_beads,
    preview_image: ''
  }
}
