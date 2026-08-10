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

  it('keeps uploaded and generated images in separate state fields', () => {
    expect(usePatternStore.getState().originalImage).toBeNull()
    expect(usePatternStore.getState().generatedImage).toBeNull()
  })

  it('uses the selected size as a square pixel grid', async () => {
    generatePatternMock.mockResolvedValue({
      mode: 'local-wasm',
      response: {
        session_id: 'local-test',
        grid_size: { width: 32, height: 32 },
        pixel_matrix: [],
        color_summary: [],
        total_beads: 0,
        palette_preset: '221',
        preview_image: ''
      }
    })
    usePatternStore.setState({ ledSize: 32 })

    await usePatternStore.getState().generateFromFile('blob:test-image')

    expect(buildGenerateFieldsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gridWidth: 32,
        gridHeight: 32,
        ledSize: 32
      })
    )
  })
})
