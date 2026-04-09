import { beforeEach, describe, expect, it, vi } from 'vitest'

const { copyFile, getImageInfo } = vi.hoisted(() => ({
  copyFile: vi.fn(),
  getImageInfo: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getImageInfo,
    getFileSystemManager: () => ({
      copyFile
    })
  }
}))

import {
  normalizeWeappAssetPath,
  isWeappUploadablePath,
  resolveWeappUploadablePath
} from '../weapp-upload'

describe('weapp upload path helpers', () => {
  beforeEach(() => {
    copyFile.mockReset()
    getImageInfo.mockReset()
    vi.restoreAllMocks()
    ;(globalThis as typeof globalThis & {
      wx?: { env?: { USER_DATA_PATH?: string } }
    }).wx = {
      env: {
        USER_DATA_PATH: 'wxfile://usr'
      }
    }
  })

  it('keeps temp file paths unchanged', async () => {
    expect(isWeappUploadablePath('wxfile://tmp/example.jpg')).toBe(true)
    await expect(resolveWeappUploadablePath('wxfile://tmp/example.jpg')).resolves.toBe(
      'wxfile://tmp/example.jpg'
    )
  })

  it('normalizes packaged asset paths for weapp runtime APIs', () => {
    expect(normalizeWeappAssetPath('/assets/examples/pony_original.jpg')).toBe(
      'assets/examples/pony_original.jpg'
    )
    expect(normalizeWeappAssetPath('assets\\examples\\pony_original.jpg')).toBe(
      'assets/examples/pony_original.jpg'
    )
  })

  it('resolves packaged assets via getImageInfo before upload', async () => {
    getImageInfo.mockResolvedValue({
      path: 'wxfile://tmp/luoxiaohei_original.jpg'
    })

    await expect(resolveWeappUploadablePath(
      '/assets/examples/luoxiaohei_original.jpg',
      'luoxiaohei_original.jpg'
    )).resolves.toBe('wxfile://tmp/luoxiaohei_original.jpg')
    expect(getImageInfo).toHaveBeenCalledWith({
      src: 'assets/examples/luoxiaohei_original.jpg'
    })
    expect(copyFile).not.toHaveBeenCalled()
  })

  it('falls back to async copy when getImageInfo cannot resolve a temp path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111)
    getImageInfo.mockRejectedValue(new Error('image info unavailable'))
    copyFile.mockImplementation(({ success }: { success: () => void }) => success())

    await expect(resolveWeappUploadablePath(
      '/assets/examples/meili_original.jpg',
      'meili_original.jpg'
    )).resolves.toBe('wxfile://usr/1711111111111_meili_original.jpg')
    expect(copyFile).toHaveBeenCalledWith(
      expect.objectContaining({
        srcPath: 'assets/examples/meili_original.jpg'
      })
    )
  })

  it('falls back to the source path when both resolution and copy fail', async () => {
    getImageInfo.mockRejectedValue(new Error('image info unavailable'))
    copyFile.mockImplementation(({ fail }: { fail: (error: Error) => void }) => {
      fail(new Error('copy failed'))
    })

    await expect(resolveWeappUploadablePath('/assets/examples/meili_original.jpg')).resolves.toBe(
      'assets/examples/meili_original.jpg'
    )
  })
})
