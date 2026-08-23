import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  registerStyleTransferAdapter,
  transformImageStyle
} from './style-transfer'

afterEach(() => {
  registerStyleTransferAdapter(null)
})

describe('style transfer adapter', () => {
  it('passes the original image through while the provider is disconnected', async () => {
    await expect(
      transformImageStyle({
        filePath: '/tmp/input.jpg',
        fileName: 'input.jpg',
        fields: { style_index: '34' }
      })
    ).resolves.toEqual({
      filePath: '/tmp/input.jpg',
      fileName: 'input.jpg'
    })
  })

  it('keeps an injectable interface for a future provider', async () => {
    const transform = vi.fn().mockResolvedValue({
      filePath: '/tmp/styled.jpg',
      fileName: 'styled.jpg'
    })
    registerStyleTransferAdapter({ transform })

    const input = {
      filePath: '/tmp/input.jpg',
      fileName: 'input.jpg',
      fields: { style_index: '34' }
    }
    await expect(transformImageStyle(input)).resolves.toEqual({
      filePath: '/tmp/styled.jpg',
      fileName: 'styled.jpg'
    })
    expect(transform).toHaveBeenCalledWith(input)
  })

  it('keeps local generation local when the caller explicitly opts out', async () => {
    const transform = vi.fn()
    registerStyleTransferAdapter({ transform })

    const input = {
      filePath: '/tmp/input.jpg',
      fileName: 'input.jpg',
      fields: { style_index: '34', style_transfer: 'none' }
    }

    await expect(transformImageStyle(input)).resolves.toEqual({
      filePath: '/tmp/input.jpg',
      fileName: 'input.jpg'
    })
    expect(transform).not.toHaveBeenCalled()
  })

  it('does not silently pretend Wanxiang succeeded when no provider is configured', async () => {
    await expect(
      transformImageStyle({
        filePath: '/tmp/input.jpg',
        fileName: 'input.jpg',
        fields: { style_index: '34', style_transfer: 'wanxiang' }
      })
    ).rejects.toThrow('万相云服务未配置')
  })
})
