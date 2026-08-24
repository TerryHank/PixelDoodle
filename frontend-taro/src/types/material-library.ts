import type {
  ColorSummaryItem,
  GridSize,
  PaletteColor,
  PixelMatrix
} from './api'

export interface MaterialGalleryWork {
  v: 1 | 2
  access: 'public'
  id: number
  title: string
  width: number
  height: number
  palette: string[]
  keys: string[]
  grid: string
  createdAt: string
  source: string
  category: string
  tags: string[]
}

export interface MaterialGalleryListResponse {
  works: MaterialGalleryWork[]
  hasMore: boolean
  total: number
  page: number
  perPage: number
  delivery?: 'remote' | 'offline'
  archiveTotal?: number
  bundledTotal?: number
  fallbackReason?: string
}

export interface MaterialGalleryDetailResponse {
  work: MaterialGalleryWork
}

export interface MaterialGalleryFilters {
  page?: number
  perPage?: number
  query?: string
  source?: string
  category?: string
  boardSize?: GridSize
}

export interface MaterialColorMapping {
  sourceHex: string
  sourceKey: string
  targetCode: string
}

export interface MaterialPatternImportPayload {
  version: 1
  kind: 'material-library'
  importId: string
  createdAt: string
  title: string
  material: {
    id: number
    source: string
    category: string
    tags: string[]
    originalSize: GridSize
  }
  boardSize: GridSize
  palettePreset: string
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
  totalBeads: number
  colorMapping: MaterialColorMapping[]
}

export interface BuildMaterialPatternImportOptions {
  boardSize: GridSize
  colors: PaletteColor[]
  palettePreset: string
  createdAt?: string
}
