import { create } from 'zustand'
import { DEFAULT_PALETTE_PRESET } from '../constants/examples'
import {
  fetchPalette,
  generatePattern,
  buildGenerateFields,
  type GeneratePatternOutcome
} from '../services/pattern-service'
import type {
  ColorSummaryItem,
  GeneratePatternResponse,
  GridSize,
  PaletteColor,
  PalettePresetMap,
  PixelMatrix
} from '../types/api'

const DEFAULT_DIFFICULTY = 0.125
const ORIGINAL_IMAGE_DIMENSION_FALLBACK = 512

function resolveGridSizeLikeOriginal(difficulty: number) {
  const scale = Number.isFinite(difficulty) && difficulty > 0 ? difficulty : DEFAULT_DIFFICULTY

  return {
    width: Math.max(16, Math.round(ORIGINAL_IMAGE_DIMENSION_FALLBACK * scale)),
    height: Math.max(16, Math.round(ORIGINAL_IMAGE_DIMENSION_FALLBACK * scale))
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
  lastGenerationMode: GeneratePatternOutcome['mode'] | null
  clear: () => void
  loadPalette: () => Promise<void>
  setExampleImage: (exampleImage: string | null) => void
  setOriginalImage: (filePath: string | null) => void
  setLedSize: (ledSize: number) => void
  setDifficulty: (difficulty: number) => void
  toggleRemoveBackground: () => void
  generateFromFile: (
    filePath: string,
    options?: {
      fileName?: string
      palettePreset?: string
      removeBackground?: boolean
      ledSize?: number
      mode?: 'fixed_grid' | 'pixel_size'
      pixelSize?: number
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
  removeBackground: false,
  ledSize: 64,
  difficulty: DEFAULT_DIFFICULTY,
  isGenerating: false,
  lastGenerationMode: null,
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
      isGenerating: false,
      lastGenerationMode: null
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
  setLedSize: (ledSize) =>
    set(() => ({
      ledSize
    })),
  setDifficulty: (difficulty) =>
    set(() => ({
      difficulty
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
      const mode = options.mode ?? 'fixed_grid'
      const fixedGridSize = resolveGridSizeLikeOriginal(state.difficulty)
      const fields = buildGenerateFields({
        mode,
        gridWidth: fixedGridSize.width,
        gridHeight: fixedGridSize.height,
        ledSize: options.ledSize ?? state.ledSize,
        pixelSize: options.pixelSize ?? 8,
        palettePreset: options.palettePreset ?? state.palettePreset,
        removeBackground: options.removeBackground ?? state.removeBackground
      })

      const outcome = await generatePattern(
        filePath,
        fields,
        options.fileName,
        {
          colors: state.fullPaletteList,
          presets: state.presets
        }
      )
      const response = outcome.response

      set(() => ({
        originalImage: filePath,
        pixelMatrix: response.pixel_matrix,
        colorSummary: response.color_summary,
        gridSize: response.grid_size,
        totalBeads: response.total_beads,
        palettePreset: response.palette_preset,
        previewImage: response.preview_image,
        sessionId: response.session_id,
        isGenerating: false,
        lastGenerationMode: outcome.mode
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
