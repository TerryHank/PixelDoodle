import { beforeEach, describe, expect, it, vi } from 'vitest'

const { uploadFileMock } = vi.hoisted(() => ({
  uploadFileMock: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    uploadFile: uploadFileMock
  }
}))

vi.mock('@/utils/runtime-env', () => ({
  getRuntimeEnv: () => 'weapp',
  normalizeRuntimeEnv: () => 'weapp'
}))

import { generatePattern } from '../pattern-service'

describe('pattern service weapp AI generation', () => {
  beforeEach(() => {
    uploadFileMock.mockReset()
  })

  it('uploads the selected image to the AI generation endpoint', async () => {
    const response = {
      session_id: 'ai-session',
      grid_size: { width: 48, height: 48 },
      pixel_matrix: [['A1']],
      color_summary: [],
      total_beads: 1,
      palette_preset: '221',
      preview_image: '',
      ai_image: 'data:image/png;base64,AA=='
    }
    uploadFileMock.mockResolvedValue({
      statusCode: 200,
      data: JSON.stringify(response)
    })

    await expect(
      generatePattern(
        '/tmp/example.png',
        {
          mode: 'fixed_grid',
          grid_width: '48',
          grid_height: '48',
          palette_preset: '221'
        },
        'example.png'
      )
    ).resolves.toEqual({
      mode: 'server-http',
      response
    })

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://beadcraft.cvalab.top/api/ai/generate',
        filePath: '/tmp/example.png',
        fileName: 'example.png',
        name: 'file'
      })
    )
  })

  it('surfaces the backend error message', async () => {
    uploadFileMock.mockResolvedValue({
      statusCode: 503,
      data: JSON.stringify({ detail: 'MINIMAX_API_KEY is not configured' })
    })

    await expect(
      generatePattern('/tmp/example.png', { grid_width: '48' }, 'example.png')
    ).rejects.toThrow('MINIMAX_API_KEY is not configured')
  })
})
