import { beforeEach, describe, expect, it, vi } from 'vitest'

const { buildGenerateFieldsMock, generatePatternMock } = vi.hoisted(() => ({
  buildGenerateFieldsMock: vi.fn((input) => input),
  generatePatternMock: vi.fn()
}))

vi.mock('../services/pattern-service', () => ({
  fetchPalette: vi.fn(),
  generatePattern: generatePatternMock,
  buildGenerateFields: buildGenerateFieldsMock
}))

import { usePatternStore } from './pattern-store'

describe('pattern store defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePatternStore.setState({
      difficulty: 0.25,
      ledSize: 64,
      boardSize: { width: 29, height: 29 },
      originalImage: null,
      isGenerating: false
    })
  })

  it('keeps background removal disabled by default', () => {
    expect(usePatternStore.getState().removeBackground).toBe(false)
  })

  it('defaults image generation to the Japanese-anime-world style', () => {
    expect(usePatternStore.getState().styleIndex).toBe(34)
  })

  it('defaults image generation to hard difficulty', () => {
    expect(usePatternStore.getState().difficulty).toBe(0.25)
  })

  it('keeps the creative board independent from the device matrix size', () => {
    usePatternStore.getState().setBoardSize({ width: 104, height: 74 })
    usePatternStore.getState().setLedSize(32)

    expect(usePatternStore.getState().boardSize).toEqual({ width: 104, height: 74 })
    expect(usePatternStore.getState().ledSize).toBe(32)
  })

  it('keeps uploaded and generated images in separate state fields', () => {
    expect(usePatternStore.getState().originalImage).toBeNull()
    expect(usePatternStore.getState().generatedImage).toBeNull()
  })

  it('passes rectangular board dimensions independently from the device size', async () => {
    generatePatternMock.mockResolvedValue({
      mode: 'local-wasm',
      response: {
        session_id: 'local-test',
        grid_size: { width: 104, height: 74 },
        pixel_matrix: [],
        color_summary: [],
        total_beads: 0,
        palette_preset: '221',
        preview_image: ''
      }
    })
    usePatternStore.getState().setBoardSize({ width: 104, height: 74 })

    await usePatternStore.getState().generateFromFile('blob:test-image')

    expect(buildGenerateFieldsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gridWidth: 104,
        gridHeight: 74,
        ledSize: 64
      })
    )
  })

  it('passes the explicit H5 style-transfer choice into generation fields', async () => {
    generatePatternMock.mockResolvedValue({
      mode: 'local-wasm',
      response: {
        session_id: 'local-test',
        grid_size: { width: 29, height: 29 },
        pixel_matrix: [],
        color_summary: [],
        total_beads: 0,
        palette_preset: '221',
        preview_image: ''
      }
    })

    await usePatternStore.getState().generateFromFile('blob:test-image', {
      styleTransfer: 'none'
    })

    expect(buildGenerateFieldsMock).toHaveBeenCalledWith(
      expect.objectContaining({ styleTransfer: 'none' })
    )
  })
})
