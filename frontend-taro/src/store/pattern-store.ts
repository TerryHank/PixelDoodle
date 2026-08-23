import { create } from 'zustand'
import { DEFAULT_PALETTE_PRESET } from '../constants/examples'
import { DEFAULT_GENERATION_STYLE_INDEX } from '../constants/generation-styles'
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

const DEFAULT_DIFFICULTY = 0.25
const DEFAULT_GRID_SIZE = 64
const DEFAULT_BOARD_SIZE: GridSize = {
  width: 29,
  height: 29
}

export interface PatternState {
  originalImage: string | null
  generatedImage: string | null
  exampleImage: string | null
  previewImage: string | null
  sessionId: string | null
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
  fullPalette: Record<string, PaletteColor>
  fullPaletteList: PaletteColor[]
  presets: PalettePresetMap
  gridSize: GridSize
  boardSize: GridSize
  totalBeads: number
  palettePreset: string
  styleIndex: number
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
  setBoardSize: (boardSize: GridSize) => void
  setDifficulty: (difficulty: number) => void
  setStyleIndex: (styleIndex: number) => void
  setPalettePreset: (palettePreset: string) => void
  toggleRemoveBackground: () => void
  generateFromFile: (
    filePath: string,
    options?: {
      fileName?: string
      prompt?: string
      referenceImageUrl?: string
      styleIndex?: number
      palettePreset?: string
      removeBackground?: boolean
      ledSize?: number
      gridWidth?: number
      gridHeight?: number
      mode?: 'fixed_grid' | 'pixel_size'
      pixelSize?: number
    }
  ) => Promise<GeneratePatternResponse>
}

export const usePatternStore = create<PatternState>((set, get) => ({
  originalImage: null,
  generatedImage: null,
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
  boardSize: DEFAULT_BOARD_SIZE,
  totalBeads: 0,
  palettePreset: DEFAULT_PALETTE_PRESET,
  styleIndex: DEFAULT_GENERATION_STYLE_INDEX,
  removeBackground: false,
  ledSize: 64,
  difficulty: DEFAULT_DIFFICULTY,
  isGenerating: false,
  lastGenerationMode: null,
  clear: () =>
    set(() => ({
      originalImage: null,
      generatedImage: null,
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
      generatedImage: null,
      exampleImage: null
    })),
  setLedSize: (ledSize) =>
    set(() => ({
      ledSize
    })),
  setBoardSize: (boardSize) =>
    set(() => ({
      boardSize: {
        width: Math.max(1, Math.round(boardSize.width)),
        height: Math.max(1, Math.round(boardSize.height))
      }
    })),
  setDifficulty: (difficulty) =>
    set(() => ({
      difficulty
    })),
  setStyleIndex: (styleIndex) =>
    set(() => ({
      styleIndex
    })),
  setPalettePreset: (palettePreset) =>
    set(() => ({
      palettePreset
    })),
  toggleRemoveBackground: () =>
    set((state) => ({
      removeBackground: !state.removeBackground
    })),
  generateFromFile: async (filePath, options = {}) => {
    set(() => ({
      isGenerating: true,
      originalImage: filePath,
      generatedImage: null
    }))

    try {
      const state = get()
      const mode = options.mode ?? 'fixed_grid'
      const selectedGridWidth = options.gridWidth ?? state.boardSize.width
      const selectedGridHeight = options.gridHeight ?? state.boardSize.height
      const gridWidth =
        Number.isFinite(selectedGridWidth) && selectedGridWidth > 0
          ? Math.round(selectedGridWidth)
          : DEFAULT_GRID_SIZE
      const gridHeight =
        Number.isFinite(selectedGridHeight) && selectedGridHeight > 0
          ? Math.round(selectedGridHeight)
          : DEFAULT_GRID_SIZE
      const selectedLedSize = options.ledSize ?? state.ledSize
      const ledSize =
        Number.isFinite(selectedLedSize) && selectedLedSize > 0
          ? Math.round(selectedLedSize)
          : DEFAULT_GRID_SIZE
      const fields = buildGenerateFields({
        mode,
        gridWidth,
        gridHeight,
        styleIndex: options.styleIndex ?? state.styleIndex,
        prompt: options.prompt,
        referenceImageUrl: options.referenceImageUrl,
        ledSize,
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
        generatedImage: response.ai_image || null,
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
