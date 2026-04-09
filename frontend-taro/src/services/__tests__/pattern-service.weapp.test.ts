import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generatePatternLocallyMock } = vi.hoisted(() => ({
  generatePatternLocallyMock: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: {}
}))

vi.mock('@/utils/runtime-env', () => ({
  getRuntimeEnv: () => 'weapp',
  normalizeRuntimeEnv: () => 'weapp'
}))

vi.mock('../local-generation', () => ({
  generatePatternLocally: generatePatternLocallyMock,
  isLocalGenerationAvailable: () => true,
  normalizeGeneratePatternResponse: (data: unknown) => data
}))

import { generatePattern } from '../pattern-service'

describe('pattern service weapp local generation', () => {
  beforeEach(() => {
    generatePatternLocallyMock.mockReset()
  })

  it('prefers local generation in weapp when available', async () => {
    const localResponse = {
      session_id: 'local-session',
      grid_size: {
        width: 48,
        height: 48
      },
      pixel_matrix: [['A1']],
      color_summary: [],
      total_beads: 1,
      palette_preset: '221',
      preview_image: ''
    }

    generatePatternLocallyMock.mockResolvedValue(localResponse)

    const outcome = await generatePattern(
      '/tmp/example.png',
      {
        mode: 'fixed_grid',
        grid_width: '48',
        grid_height: '48',
        palette_preset: '221'
      },
      'example.png',
      {
        colors: [],
        presets: {}
      }
    )

    expect(generatePatternLocallyMock).toHaveBeenCalledWith(
      '/tmp/example.png',
      {
        mode: 'fixed_grid',
        grid_width: '48',
        grid_height: '48',
        palette_preset: '221'
      },
      {
        colors: [],
        presets: {}
      }
    )
    expect(outcome).toEqual({
      mode: 'local-js',
      response: localResponse
    })
  })

  it('does not fall back to server upload when local generation fails', async () => {
    generatePatternLocallyMock.mockRejectedValue(new Error('local wasm failed'))

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
        {
          colors: [],
          presets: {}
        }
      )
    ).rejects.toThrow('local wasm failed')
  })
})
