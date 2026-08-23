import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/taro', () => ({
  default: {
    getEnv: vi.fn(() => 'WEB'),
    getImageInfo: vi.fn(),
    getFileInfo: vi.fn()
  }
}))

import {
  registerStyleTransferAdapter,
  transformImageStyle
} from './style-transfer'
import {
  createWanxiangCloudBaseAdapter,
  initializeWanxiangCloudBase,
  type WanxiangCloudBaseClient
} from './wanxiang-cloudbase'

function createClient(
  overrides: Partial<WanxiangCloudBaseClient> = {}
): WanxiangCloudBaseClient {
  return {
    getImageInfo: vi.fn().mockResolvedValue({ width: 1024, height: 1024 }),
    getFileInfo: vi.fn().mockResolvedValue({ size: 1024 * 1024 }),
    uploadFile: vi.fn().mockResolvedValue({ fileID: 'cloud://input.jpg' }),
    callFunction: vi.fn(),
    deleteFile: vi.fn().mockResolvedValue({}),
    downloadFile: vi.fn().mockResolvedValue({ tempFilePath: '/tmp/output.jpg' }),
    ...overrides
  }
}

const input = {
  filePath: '/tmp/input.jpg',
  fileName: 'input.jpg',
  fields: { style_index: '34' }
}

afterEach(() => {
  registerStyleTransferAdapter(null)
  vi.restoreAllMocks()
})

describe('Wanxiang CloudBase style transfer adapter', () => {
  it('uploads, submits, removes the input, polls and downloads the result', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const client = createClient()
    vi.mocked(client.callFunction)
      .mockResolvedValueOnce({
        result: {
          success: true,
          status: 'PENDING',
          taskId: 'task-1'
        }
      })
      .mockResolvedValueOnce({
        result: { success: true, status: 'RUNNING' }
      })
      .mockResolvedValueOnce({
        result: {
          success: true,
          status: 'SUCCEEDED',
          fileID: 'cloud://output.jpg',
          mediaType: 'image/jpeg'
        }
      })

    const adapter = createWanxiangCloudBaseAdapter(client, {
      pollIntervalMs: 1,
      maxPollAttempts: 3,
      sleep,
      now: () => 123,
      random: () => 'fixed'
    })

    await expect(adapter.transform(input)).resolves.toEqual({
      filePath: '/tmp/output.jpg',
      fileName: 'input.jpg',
      generatedImage: 'cloud://output.jpg'
    })
    expect(client.uploadFile).toHaveBeenCalledWith({
      cloudPath: 'wanxiang/input/123-fixed.jpg',
      filePath: '/tmp/input.jpg'
    })
    expect(client.callFunction).toHaveBeenNthCalledWith(1, {
      name: 'submitStyleTransfer',
      data: { fileID: 'cloud://input.jpg', styleIndex: 34 }
    })
    expect(client.deleteFile).toHaveBeenCalledWith(['cloud://input.jpg'])
    expect(
      vi.mocked(client.deleteFile).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(client.callFunction).mock.invocationCallOrder[1])
    expect(client.callFunction).toHaveBeenNthCalledWith(2, {
      name: 'queryStyleTransfer',
      data: { taskId: 'task-1' }
    })
    expect(client.downloadFile).toHaveBeenCalledWith('cloud://output.jpg')
    expect(sleep).toHaveBeenCalledOnce()
    expect(sleep).toHaveBeenCalledWith(1)
  })

  it.each([
    [{ width: 255, height: 800 }, { size: 1024 }, '不能小于 256'],
    [{ width: 5761, height: 3000 }, { size: 1024 }, '长边不能超过 5760'],
    [{ width: 4000, height: 3241 }, { size: 1024 }, '短边不能超过 3240'],
    [{ width: 1000, height: 499 }, { size: 1024 }, '比例不能超过 2:1'],
    [
      { width: 1000, height: 1000 },
      { size: 10 * 1024 * 1024 + 1 },
      '不能超过 10MB'
    ]
  ])('rejects an invalid source before upload', async (imageInfo, fileInfo, message) => {
    const client = createClient({
      getImageInfo: vi.fn().mockResolvedValue(imageInfo),
      getFileInfo: vi.fn().mockResolvedValue(fileInfo)
    })
    const adapter = createWanxiangCloudBaseAdapter(client)

    await expect(adapter.transform(input)).rejects.toThrow(message)
    expect(client.getImageInfo).toHaveBeenCalledWith('/tmp/input.jpg')
    expect(client.getFileInfo).toHaveBeenCalledWith('/tmp/input.jpg')
    expect(client.uploadFile).not.toHaveBeenCalled()
  })

  it('surfaces a Chinese error when the cloud task fails', async () => {
    const client = createClient()
    vi.mocked(client.callFunction)
      .mockResolvedValueOnce({
        result: { success: true, status: 'PENDING', taskId: 'task-2' }
      })
      .mockResolvedValueOnce({
        result: {
          success: false,
          status: 'FAILED',
          code: 'DataInspectionFailed',
          message: '内容审核未通过'
        }
      })
    const adapter = createWanxiangCloudBaseAdapter(client, {
      sleep: vi.fn().mockResolvedValue(undefined)
    })

    await expect(adapter.transform(input)).rejects.toThrow(
      '万相生成失败：内容审核未通过'
    )
  })

  it('rejects an unsupported style before upload', async () => {
    const client = createClient()
    const adapter = createWanxiangCloudBaseAdapter(client)

    await expect(
      adapter.transform({ ...input, fields: { style_index: '29' } })
    ).rejects.toThrow('万相风格编号无效')
    expect(client.uploadFile).not.toHaveBeenCalled()
  })

  it('stops after the injected poll limit and reports a Chinese timeout', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const client = createClient()
    vi.mocked(client.callFunction)
      .mockResolvedValueOnce({
        result: { success: true, status: 'PENDING', taskId: 'task-3' }
      })
      .mockResolvedValue({ result: { success: true, status: 'PENDING' } })
    const adapter = createWanxiangCloudBaseAdapter(client, {
      pollIntervalMs: 5,
      maxPollAttempts: 2,
      sleep
    })

    await expect(adapter.transform(input)).rejects.toThrow(
      '万相生成超时，请稍后重试'
    )
    expect(client.callFunction).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('does not initialize or register the adapter outside WeApp', async () => {
    const cloud = {
      init: vi.fn(),
      uploadFile: vi.fn(),
      callFunction: vi.fn(),
      deleteFile: vi.fn(),
      downloadFile: vi.fn()
    }

    expect(initializeWanxiangCloudBase({ runtimeEnv: 'h5', cloud })).toBe(false)
    expect(cloud.init).not.toHaveBeenCalled()
    await expect(transformImageStyle(input)).resolves.toEqual({
      filePath: '/tmp/input.jpg',
      fileName: 'input.jpg'
    })
  })

  it('keeps WeApp open and reports configuration errors when CloudBase is unavailable', async () => {
    expect(initializeWanxiangCloudBase({ runtimeEnv: 'weapp' })).toBe(false)
    await expect(transformImageStyle(input)).rejects.toThrow('微信云开发不可用')
  })
})
