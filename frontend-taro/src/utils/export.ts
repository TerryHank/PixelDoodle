import type { ColorSummaryItem, PaletteColor, PixelMatrix } from '../types/api'
import type { ExportKind } from '../services/pattern-service'

const EXPORT_MIME_TYPES: Record<ExportKind, string> = {
  png: 'image/png',
  pdf: 'application/pdf',
  json: 'application/json'
}

export function getExportMimeType(kind: ExportKind) {
  return EXPORT_MIME_TYPES[kind]
}

export function getExportFileName(kind: ExportKind, sessionId?: string | null) {
  const suffix = sessionId || String(Date.now())
  return `beadcraft_pattern_${suffix}.${kind}`
}

export function buildColorHexMap(
  pixelMatrix: PixelMatrix,
  colorSummary: ColorSummaryItem[],
  fullPalette: Record<string, PaletteColor>
) {
  const colorMap: Record<string, string> = {}

  colorSummary.forEach((item) => {
    colorMap[item.code] = item.hex
  })

  pixelMatrix.forEach((row) => {
    row.forEach((code) => {
      if (!code || colorMap[code] || !fullPalette[code]) {
        return
      }

      colorMap[code] = fullPalette[code].hex
    })
  })

  return colorMap
}

export function buildPaletteLookup(
  pixelMatrix: PixelMatrix,
  colorSummary: ColorSummaryItem[],
  fullPalette: Record<string, PaletteColor>
) {
  const paletteLookup: Record<string, PaletteColor> = {
    ...fullPalette
  }

  colorSummary.forEach((item) => {
    paletteLookup[item.code] = item
  })

  pixelMatrix.forEach((row) => {
    row.forEach((code) => {
      if (!code || paletteLookup[code] || !fullPalette[code]) {
        return
      }

      paletteLookup[code] = fullPalette[code]
    })
  })

  return paletteLookup
}
