import type {
  ColorSummaryItem,
  GridSize,
  JsonValue,
  PixelMatrix
} from './api'

export const PRIVATE_CLOUD_CANVAS_SCHEMA = 'pixeldoodle.canvas/v1' as const

export interface PrivateCloudCanvasDocument {
  schema_version: typeof PRIVATE_CLOUD_CANVAS_SCHEMA
  grid_size: GridSize
  pixel_matrix: PixelMatrix
  color_summary: ColorSummaryItem[]
  total_beads: number
  palette_preset: string
  editor_state?: Record<string, JsonValue>
}

export interface PrivateCloudWorkSummary {
  id: string
  title: string
  source_label: string
  grid_size: GridSize
  palette_preset: string
  total_beads: number
  version: number
  content_sha256: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface PrivateCloudWork extends PrivateCloudWorkSummary {
  document: PrivateCloudCanvasDocument
}

export interface PrivateCloudWorkPage {
  items: PrivateCloudWorkSummary[]
  total: number
  limit: number
  offset: number
}

export interface CreatePrivateCloudWorkRequest {
  title: string
  source_label?: string
  document: PrivateCloudCanvasDocument
}
export interface UpdatePrivateCloudWorkRequest {
  expected_version: number
  title?: string
  source_label?: string
  document: PrivateCloudCanvasDocument
}
