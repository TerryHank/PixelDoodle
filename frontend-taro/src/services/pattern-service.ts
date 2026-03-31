import type {
  ApiErrorResponse,
  GeneratePatternResponse,
  PaletteResponse
} from '../types/api'
import { getApiBaseUrl } from './env'

export type ExportKind = 'png' | 'pdf' | 'json'

export interface GeneratePatternInput {
  gridWidth: number
  gridHeight: number
  palettePreset: string
  mode?: 'fixed_grid' | 'pixel_size'
  ledSize?: number
  pixelSize?: number
  useDithering?: boolean
  maxColors?: number
  similarityThreshold?: number
  removeBackground?: boolean
  contrast?: number
  saturation?: number
  sharpness?: number
}

function getErrorMessage(statusCode: number, data: unknown) {
  if (data && typeof data === 'object') {
    const errorData = data as Partial<ApiErrorResponse>
    if (errorData.detail) {
      return errorData.detail
    }
    if (errorData.message) {
      return errorData.message
    }
  }

  return `Request failed with status ${statusCode}`
}

function parseJsonResponse<TResponse>(raw: string, statusCode: number) {
  const data = JSON.parse(raw) as TResponse | ApiErrorResponse

  if (statusCode >= 400) {
    throw new Error(getErrorMessage(statusCode, data))
  }

  return data as TResponse
}

export function buildGenerateFields(input: GeneratePatternInput) {
  return {
    mode: input.mode ?? 'fixed_grid',
    grid_width: String(input.gridWidth),
    grid_height: String(input.gridHeight),
    led_size: String(input.ledSize ?? 64),
    pixel_size: String(input.pixelSize ?? 8),
    use_dithering: String(Boolean(input.useDithering)),
    palette_preset: input.palettePreset,
    max_colors: String(input.maxColors ?? 0),
    similarity_threshold: String(input.similarityThreshold ?? 0),
    remove_bg: String(Boolean(input.removeBackground)),
    contrast: String(input.contrast ?? 0),
    saturation: String(input.saturation ?? 0),
    sharpness: String(input.sharpness ?? 0)
  }
}

export async function fetchPalette() {
  const { requestJson } = await import('./http')
  return requestJson<PaletteResponse>('/api/palette')
}

export async function generatePattern(
  filePath: string,
  fields: Record<string, string>,
  fileName?: string
) {
  const Taro = (await import('@tarojs/taro')).default
  const response = await Taro.uploadFile({
    url: `${getApiBaseUrl()}/api/generate`,
    filePath,
    fileName,
    name: 'file',
    formData: fields
  })

  return parseJsonResponse<GeneratePatternResponse>(
    response.data,
    response.statusCode
  )
}

export async function exportPattern(kind: ExportKind, payload: unknown) {
  const Taro = (await import('@tarojs/taro')).default
  const response = await Taro.request<ArrayBuffer | ApiErrorResponse>({
    url: `${getApiBaseUrl()}/api/export/${kind}`,
    method: 'POST',
    header: {
      'content-type': 'application/json'
    },
    data: payload,
    responseType: 'arraybuffer'
  })

  if (response.statusCode >= 400) {
    throw new Error(getErrorMessage(response.statusCode, response.data))
  }

  return response.data as ArrayBuffer
}
