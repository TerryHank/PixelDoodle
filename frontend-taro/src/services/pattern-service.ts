import type {
  ApiErrorResponse,
  GeneratePatternResponse,
  PaletteResponse
} from '../types/api'
import { getApiBaseUrl } from './env'
import { getRuntimeEnv } from '@/utils/runtime-env'
import type { GenerateTransportMode } from './local-generation'

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
      return new Error('AI 图片生成超时，请稍后重试')
    }
    return error
  }

  if (error && typeof error === 'object' && 'errMsg' in error) {
    const errMsg = String((error as { errMsg?: unknown }).errMsg || '')
    if (errMsg.toLowerCase().includes('timeout')) {
      return new Error('AI 图片生成超时，请稍后重试')
    }
    if (errMsg) {
      return new Error(errMsg)
    }
  }

  return new Error('AI 图案生成失败')
}

function parseJsonResponse<TResponse>(raw: string, statusCode: number) {
  let data: TResponse | ApiErrorResponse
  try {
    data = JSON.parse(raw) as TResponse | ApiErrorResponse
  } catch {
    throw new Error(`Request failed with status ${statusCode}`)
  }

  if (statusCode >= 400) {
    throw new Error(getErrorMessage(statusCode, data))
  }

  return data as TResponse
}

async function uploadAiImageForH5(
  filePath: string,
  fields: Record<string, string>,
  fileName?: string
) {
  const imageResponse = await fetch(filePath)
  if (!imageResponse.ok) {
    throw new Error('无法读取待上传图片')
  }

  const imageBlob = await imageResponse.blob()
  const formData = new FormData()
  formData.append('file', imageBlob, fileName || 'upload-image.png')
  Object.entries(fields).forEach(([key, value]) => formData.append(key, value))

  const response = await fetch(`${getApiBaseUrl()}/api/ai/generate`, {
    method: 'POST',
    body: formData
  })
  const raw = await response.text()
  return parseJsonResponse<GeneratePatternResponse>(raw, response.status)
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
) : Promise<GeneratePatternOutcome> {
  try {
    const runtime = getRuntimeEnv()
    if (runtime === 'h5') {
      return {
        mode: 'server-http',
        response: await uploadAiImageForH5(filePath, fields, fileName)
      }
    }

    const Taro = (await import('@tarojs/taro')).default
    const response = await Taro.uploadFile({
      url: `${getApiBaseUrl()}/api/ai/generate`,
      filePath,
      fileName,
      name: 'file',
      formData: fields
    })

    return {
      mode: 'server-http',
      response: parseJsonResponse<GeneratePatternResponse>(
        response.data,
        response.statusCode
      )
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
