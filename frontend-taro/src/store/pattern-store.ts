import { create } from 'zustand'
import Taro from '@tarojs/taro'
import { DEFAULT_PALETTE_PRESET } from '../constants/examples'
import { fetchPalette, generatePattern, buildGenerateFields } from '../services/pattern-service'
import type {
  ColorSummaryItem,
  GeneratePatternResponse,
  GridSize,
  PaletteColor,
  PalettePresetMap,
  PixelMatrix
} from '../types/api'

const DEFAULT_DIFFICULTY = 0.125

async function resolveGridSize(filePath: string, difficulty: number) {
  const imageInfo = await Taro.getImageInfo({ src: filePath })
  const scale = Number.isFinite(difficulty) && difficulty > 0 ? difficulty : DEFAULT_DIFFICULTY

  return {
    width: Math.max(16, Math.round(imageInfo.width * scale)),
    height: Math.max(16, Math.round(imageInfo.height * scale))
  }
}

export interface PatternState {
  originalImage: string | null
  exampleImage: string | null
  previewImage: string | null
  sessionId: string | null
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
  fullPalette: Record<string, PaletteColor>
  fullPaletteList: PaletteColor[]
  presets: PalettePresetMap
  gridSize: GridSize
  totalBeads: number
  palettePreset: string
  removeBackground: boolean
  ledSize: number
  difficulty: number
  isGenerating: boolean
  clear: () => void
  loadPalette: () => Promise<void>
  setExampleImage: (exampleImage: string | null) => void
  setOriginalImage: (filePath: string | null) => void
  toggleRemoveBackground: () => void
  generateFromFile: (
    filePath: string,
    options?: {
      fileName?: string
      palettePreset?: string
      removeBackground?: boolean
      ledSize?: number
    }
  ) => Promise<GeneratePatternResponse>
}

export const usePatternStore = create<PatternState>((set, get) => ({
  originalImage: null,
  exampleImage: null,
  previewImage: null,
  sessionId: null,
  pixelMatrix: [],
  colorSummary: [],
  fullPalette: {},
  fullPaletteList: [],
  presets: {},
  gridSize: {
    width: 0,
    height: 0
  },
  totalBeads: 0,
  palettePreset: DEFAULT_PALETTE_PRESET,
  removeBackground: true,
  ledSize: 64,
  difficulty: DEFAULT_DIFFICULTY,
  isGenerating: false,
  clear: () =>
    set(() => ({
      originalImage: null,
      exampleImage: null,
      previewImage: null,
      sessionId: null,
      pixelMatrix: [],
      colorSummary: [],
      gridSize: {
        width: 0,
        height: 0
      },
      totalBeads: 0,
      isGenerating: false
    })),
  loadPalette: async () => {
    const response = await fetchPalette()
    const fullPalette = response.colors.reduce<Record<string, PaletteColor>>(
      (accumulator, item) => {
        accumulator[item.code] = item
        return accumulator
      },
      {}
    )

    set(() => ({
      fullPalette,
      fullPaletteList: response.colors,
      presets: response.presets
    }))
  },
  setExampleImage: (exampleImage) =>
    set(() => ({
      exampleImage
    })),
  setOriginalImage: (filePath) =>
    set(() => ({
      originalImage: filePath,
      exampleImage: null
    })),
  toggleRemoveBackground: () =>
    set((state) => ({
      removeBackground: !state.removeBackground
    })),
  generateFromFile: async (filePath, options = {}) => {
    set(() => ({
      isGenerating: true,
      originalImage: filePath
    }))

    try {
      const state = get()
      const gridSize = await resolveGridSize(filePath, state.difficulty)
      const fields = buildGenerateFields({
        gridWidth: gridSize.width,
        gridHeight: gridSize.height,
        ledSize: options.ledSize ?? state.ledSize,
        palettePreset: options.palettePreset ?? state.palettePreset,
        removeBackground: options.removeBackground ?? state.removeBackground
      })

      const response = await generatePattern(filePath, fields, options.fileName)

      set(() => ({
        originalImage: filePath,
        pixelMatrix: response.pixel_matrix,
        colorSummary: response.color_summary,
        gridSize: response.grid_size,
        totalBeads: response.total_beads,
        palettePreset: response.palette_preset,
        previewImage: response.preview_image,
        sessionId: response.session_id,
        isGenerating: false
      }))

      return response
    } catch (error) {
      set(() => ({
        isGenerating: false
      }))

      throw error
    }
  }
}))
