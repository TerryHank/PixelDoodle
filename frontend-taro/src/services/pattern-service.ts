import type { GeneratePatternResponse } from '../types/api'
import { getRuntimeEnv } from '@/utils/runtime-env'
import {
  generatePatternLocally,
  type GenerateTransportMode,
  type LocalPaletteData
} from './local-generation'
import { exportPatternLocally } from './local-export'
import { getLocalPalette } from './local-palette'
import { transformImageStyle } from './style-transfer'

export type ExportKind = 'png' | 'pdf' | 'json'

export interface GeneratePatternOutcome {
  mode: GenerateTransportMode
  response: GeneratePatternResponse
}

export interface GeneratePatternInput {
  gridWidth: number
  gridHeight: number
  palettePreset: string
  styleIndex: number
  prompt?: string
  referenceImageUrl?: string
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

function normalizeGenerationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.toLowerCase().includes('timeout')) {
      return new Error('图片生成超时，请稍后重试')
    }
    return error
  }

  return new Error('本地图案生成失败')
}

export function buildGenerateFields(input: GeneratePatternInput) {
  const fields: Record<string, string> = {
    mode: input.mode ?? 'fixed_grid',
    grid_width: String(input.gridWidth),
    grid_height: String(input.gridHeight),
    led_size: String(input.ledSize ?? 64),
    pixel_size: String(input.pixelSize ?? 8),
    use_dithering: String(Boolean(input.useDithering)),
    palette_preset: input.palettePreset,
    style_index: String(input.styleIndex),
    max_colors: String(input.maxColors ?? 0),
    similarity_threshold: String(input.similarityThreshold ?? 0),
    remove_bg: String(Boolean(input.removeBackground)),
    contrast: String(input.contrast ?? 0),
    saturation: String(input.saturation ?? 0),
    sharpness: String(input.sharpness ?? 0)
  }

  if (input.prompt?.trim()) {
    fields.prompt = input.prompt.trim()
  }
  if (input.referenceImageUrl?.trim()) {
    fields.reference_image_url = input.referenceImageUrl.trim()
  }

  return fields
}

export async function fetchPalette() {
  return getLocalPalette()
}

export async function generatePattern(
  filePath: string,
  fields: Record<string, string>,
  fileName?: string,
  paletteData?: LocalPaletteData
): Promise<GeneratePatternOutcome> {
  try {
    const styledImage = await transformImageStyle({ filePath, fileName, fields })
    const response = await generatePatternLocally(
      styledImage.filePath,
      fields,
      paletteData ?? getLocalPalette()
    )

    return {
      mode: getRuntimeEnv() === 'weapp' ? 'local-js' : 'local-wasm',
      response: styledImage.generatedImage
        ? { ...response, ai_image: styledImage.generatedImage }
        : response
    }
  } catch (error) {
    throw normalizeGenerationError(error)
  }
}

export async function exportPattern(kind: ExportKind, payload: unknown) {
  return exportPatternLocally(kind, payload)
}
