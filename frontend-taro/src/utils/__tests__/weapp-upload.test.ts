import { beforeEach, describe, expect, it, vi } from 'vitest'

const copyFileSync = vi.fn()

vi.mock('@tarojs/taro', () => ({
  default: {
    getFileSystemManager: () => ({
      copyFileSync
    })
  }
}))

import {
  isWeappUploadablePath,
  resolveWeappUploadablePath
} from '../weapp-upload'

describe('weapp upload path helpers', () => {
  beforeEach(() => {
    copyFileSync.mockReset()
    vi.restoreAllMocks()
    ;(globalThis as typeof globalThis & {
      wx?: { env?: { USER_DATA_PATH?: string } }
    }).wx = {
      env: {
        USER_DATA_PATH: 'wxfile://usr'
      }
    }
  })

  it('keeps temp file paths unchanged', () => {
    expect(isWeappUploadablePath('wxfile://tmp/example.jpg')).toBe(true)
    expect(resolveWeappUploadablePath('wxfile://tmp/example.jpg')).toBe(
      'wxfile://tmp/example.jpg'
    )
  })

  it('copies packaged assets into user data path before upload', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111)

    const nextPath = resolveWeappUploadablePath(
      '/assets/examples/luoxiaohei_original.jpg',
      'luoxiaohei_original.jpg'
    )

    expect(copyFileSync).toHaveBeenCalledWith(
      '/assets/examples/luoxiaohei_original.jpg',
      'wxfile://usr/1711111111111_luoxiaohei_original.jpg'
    )
    expect(nextPath).toBe('wxfile://usr/1711111111111_luoxiaohei_original.jpg')
  })

  it('falls back to the source path when copy fails', () => {
    copyFileSync.mockImplementation(() => {
      throw new Error('copy failed')
    })

    expect(resolveWeappUploadablePath('/assets/examples/meili_original.jpg')).toBe(
      '/assets/examples/meili_original.jpg'
    )
  })
})
