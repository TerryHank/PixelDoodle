import type { PatternState } from '@/store/pattern-store'
import type { PatternHistoryEntry } from '@/types/community'

type RestoredPatternState = Pick<
  PatternState,
  | 'originalImage'
  | 'generatedImage'
  | 'exampleImage'
  | 'previewImage'
  | 'sessionId'
  | 'pixelMatrix'
  | 'colorSummary'
  | 'gridSize'
  | 'boardSize'
  | 'totalBeads'
  | 'palettePreset'
  | 'isGenerating'
  | 'lastGenerationMode'
>

export function buildPatternStateFromHistory(
  entry: PatternHistoryEntry
): RestoredPatternState {
  return {
    originalImage: null,
    generatedImage: null,
    exampleImage: null,
    previewImage: null,
    sessionId: `history-${entry.id}`,
    pixelMatrix: entry.pixelMatrix.map((row) => [...row]),
    colorSummary: entry.colorSummary.map((item) => ({ ...item })),
    gridSize: { ...entry.gridSize },
    boardSize: { ...entry.gridSize },
    totalBeads: entry.totalBeads,
    palettePreset: entry.palettePreset,
    isGenerating: false,
    lastGenerationMode: null
  }
}
