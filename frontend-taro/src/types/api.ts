export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type PixelCell = string | null
export type PixelMatrix = PixelCell[][]

export interface GridSize {
  width: number
  height: number
}

export interface PaletteColor {
  code: string
  name: string
  name_zh: string
  hex: string
  rgb: [number, number, number]
}

export interface PalettePreset {
  label: string
  codes: string[] | null
}

export type PalettePresetMap = Record<string, PalettePreset>

export interface PaletteResponse {
  colors: PaletteColor[]
  presets: PalettePresetMap
}

export interface ColorSummaryItem extends PaletteColor {
  count: number
}

export interface GeneratePatternResponse {
  session_id: string
  grid_size: GridSize
  pixel_matrix: PixelMatrix
  color_summary: ColorSummaryItem[]
  total_beads: number
  palette_preset: string
  preview_image: string
}

export interface ExportJsonResponse {
  version: string
  exported_at: string
  dimensions: GridSize
  pixel_matrix: PixelMatrix
  color_summary: ColorSummaryItem[]
}

export interface WifiDeviceRecord {
  ip: string
  updated_at: number
}

export interface WifiDeviceMapResponse {
  devices: Record<string, WifiDeviceRecord>
  count: number
}

export interface WifiRegisterRequest {
  device_uuid: string
  ip: string
}

export interface WifiRegisterResponse {
  success: true
  device_uuid: string
  ip: string
}

export interface WifiSendRequest {
  device_uuid: string
  pixel_matrix: PixelMatrix
  background_color?: [number, number, number]
}

export interface WifiSendResponse {
  success: true
  bytes_sent: number
  duration_ms: number
  device_uuid: string
  ip: string
}

export interface WifiHighlightRequest {
  device_uuid: string
  highlight_colors?: [number, number, number][]
}

export interface WifiHighlightResponse {
  success: true
  device_uuid: string
  ip: string
}

export interface ApiErrorResponse {
  detail: string
}
