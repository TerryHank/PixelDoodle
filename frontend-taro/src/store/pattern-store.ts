import { create } from 'zustand'
import type { ColorSummaryItem, GridSize, PixelMatrix } from '../types/api'
import { DEFAULT_PALETTE_PRESET } from '../constants/examples'

export interface PatternState {
  originalImage: string | null
  exampleImage: string | null
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
  gridSize: GridSize
  totalBeads: number
  palettePreset: string
  removeBackground: boolean
  ledSize: number
  difficulty: number
}

export const usePatternStore = create<PatternState>(() => ({
  originalImage: null,
  exampleImage: null,
  pixelMatrix: [],
  colorSummary: [],
  gridSize: {
    width: 0,
    height: 0
  },
  totalBeads: 0,
  palettePreset: DEFAULT_PALETTE_PRESET,
  removeBackground: false,
  ledSize: 64,
  difficulty: 1
}))

