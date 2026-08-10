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
})
