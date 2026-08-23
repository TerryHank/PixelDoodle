import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generatePatternLocallyMock, transformImageStyleMock } = vi.hoisted(() => ({
  generatePatternLocallyMock: vi.fn(),
  transformImageStyleMock: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    ENV_TYPE: {
      WEB: 'WEB',
      WEAPP: 'WEAPP',
      RN: 'RN'
    },
    getEnv: () => 'WEB'
  }
}))

vi.mock('../local-generation', () => ({
  generatePatternLocally: generatePatternLocallyMock
}))

vi.mock('../style-transfer', () => ({
  transformImageStyle: transformImageStyleMock
}))

import {
  buildGenerateFields,
  exportPattern,
  fetchPalette,
  generatePattern
} from '../pattern-service'

const paletteData = {
  colors: [
    {
      code: 'A1',
      name: 'White',
      name_zh: '白色',
      hex: '#FFFFFF',
      rgb: [255, 255, 255] as [number, number, number]
    }
  ],
  presets: {}
}

describe('pattern service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transformImageStyleMock.mockImplementation(async (input) => ({
      filePath: input.filePath,
      fileName: input.fileName
    }))
  })

  it('serializes generate options', () => {
    const fields = buildGenerateFields({
      gridWidth: 48,
      gridHeight: 48,
      palettePreset: '221',
      styleIndex: 32,
      styleTransfer: 'wanxiang',
      prompt: '  watercolor animation  ',
      referenceImageUrl: '  https://cdn.example.com/reference.png  '
    })

    expect(fields.grid_width).toBe('48')
    expect(fields.grid_height).toBe('48')
    expect(fields.palette_preset).toBe('221')
    expect(fields.style_index).toBe('32')
    expect(fields.style_transfer).toBe('wanxiang')
    expect(fields.prompt).toBe('watercolor animation')
    expect(fields.reference_image_url).toBe(
      'https://cdn.example.com/reference.png'
    )
  })

  it('loads the Artkal palette without requesting a backend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const response = await fetchPalette()

    expect(response.colors.length).toBeGreaterThan(200)
    expect(response.presets['221']).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('bypasses style conversion and generates H5 patterns locally', async () => {
    const generatedPattern = {
      session_id: 'local-session',
      grid_size: { width: 48, height: 48 },
      pixel_matrix: [['A1']],
      color_summary: [],
      total_beads: 1,
      palette_preset: '221',
      preview_image: ''
    }
    generatePatternLocallyMock.mockResolvedValue(generatedPattern)
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      generatePattern(
        'blob:uploaded-image',
        { grid_width: '48', style_index: '34' },
        'image.png',
        paletteData
      )
    ).resolves.toEqual({
      mode: 'local-wasm',
      response: generatedPattern
    })

    expect(transformImageStyleMock).toHaveBeenCalledWith({
      filePath: 'blob:uploaded-image',
      fileName: 'image.png',
      fields: { grid_width: '48', style_index: '34' }
    })
    expect(generatePatternLocallyMock).toHaveBeenCalledWith(
      'blob:uploaded-image',
      { grid_width: '48', style_index: '34' },
      paletteData
    )
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('exports JSON locally without requesting a backend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const result = await exportPattern('json', {
      pixel_matrix: [['A1']],
      color_summary: [{ code: 'A1', count: 1 }]
    })
    const parsed = JSON.parse(new TextDecoder().decode(result))

    expect(parsed.pixel_matrix).toEqual([['A1']])
    expect(parsed.color_summary).toEqual([{ code: 'A1', count: 1 }])
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
