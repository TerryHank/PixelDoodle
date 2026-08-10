import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generatePatternLocallyMock, transformImageStyleMock } = vi.hoisted(() => ({
  generatePatternLocallyMock: vi.fn(),
  transformImageStyleMock: vi.fn()
}))

vi.mock('@/utils/runtime-env', () => ({
  getRuntimeEnv: () => 'weapp',
  normalizeRuntimeEnv: () => 'weapp'
}))

vi.mock('../local-generation', () => ({
  generatePatternLocally: generatePatternLocallyMock
}))

vi.mock('../style-transfer', () => ({
  transformImageStyle: transformImageStyleMock
}))

import { generatePattern } from '../pattern-service'

describe('pattern service weapp local generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transformImageStyleMock.mockImplementation(async (input) => ({
      filePath: input.filePath,
      fileName: input.fileName
    }))
  })

  it('processes the selected image without uploading it', async () => {
    const response = {
      session_id: 'local-session',
      grid_size: { width: 48, height: 48 },
      pixel_matrix: [['A1']],
      color_summary: [],
      total_beads: 1,
      palette_preset: '221',
      preview_image: ''
    }
    const paletteData = {
      colors: [],
      presets: {}
    }
    generatePatternLocallyMock.mockResolvedValue(response)

    await expect(
      generatePattern(
        '/tmp/example.png',
        {
          mode: 'fixed_grid',
          grid_width: '48',
          grid_height: '48',
          palette_preset: '221'
        },
        'example.png',
        paletteData
      )
    ).resolves.toEqual({
      mode: 'local-js',
      response
    })

    expect(generatePatternLocallyMock).toHaveBeenCalledWith(
      '/tmp/example.png',
      expect.objectContaining({ grid_width: '48' }),
      paletteData
    )
  })
})
