import type {
  ApiErrorResponse,
  GeneratePatternResponse,
  PaletteResponse
} from '../types/api'
import { getApiBaseUrl } from './env'
import { getRuntimeEnv } from '@/utils/runtime-env'
import {
  generatePatternLocally,
  getLocalGenerationUnavailableReason,
  isLocalGenerationAvailable,
  type GenerateTransportMode,
  type LocalPaletteData
} from './local-generation'

export type ExportKind = 'png' | 'pdf' | 'json'

export interface GeneratePatternOutcome {
  mode: GenerateTransportMode
  response: GeneratePatternResponse
}

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

function normalizeUploadError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.toLowerCase().includes('timeout')) {
      return new Error('本地生成超时，请稍后重试')
    }
    return error
  }

  if (error && typeof error === 'object' && 'errMsg' in error) {
    const errMsg = String((error as { errMsg?: unknown }).errMsg || '')
    if (errMsg.toLowerCase().includes('timeout')) {
      return new Error('本地生成超时，请稍后重试')
    }
    if (errMsg) {
      return new Error(errMsg)
    }
  }

  return new Error('图案生成失败')
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
  _fileName?: string,
  localPaletteData?: LocalPaletteData
) : Promise<GeneratePatternOutcome> {
  if (!isLocalGenerationAvailable()) {
    throw new Error(
      getLocalGenerationUnavailableReason() || '当前环境不支持本地生成'
    )
  }

  try {
    const runtime = getRuntimeEnv()
    return {
      mode: runtime === 'weapp' ? 'local-js' : 'local-wasm',
      response: await generatePatternLocally(filePath, fields, localPaletteData)
    }
  } catch (error) {
    throw normalizeUploadError(error)
  }
}

export async function exportPattern(kind: ExportKind, payload: unknown) {
  if (getRuntimeEnv() === 'h5') {
    const response = await fetch(`${getApiBaseUrl()}/api/export/${kind}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const raw = await response.text()
      let data: unknown = raw
      try {
        data = JSON.parse(raw)
      } catch {}
      throw new Error(getErrorMessage(response.status, data))
    }

    return response.arrayBuffer()
  }

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
