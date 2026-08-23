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
  initializeWanxiangCloudBaseH5,
  type CloudBaseWebApp,
  type CloudBaseWebSdk
} from './wanxiang-cloudbase-h5'

function createWebApp() {
  const order: string[] = []
  const auth = {
    getSession: vi.fn().mockImplementation(async () => {
      order.push('get-session')
      return { data: { session: null }, error: null }
    }),
    signInAnonymously: vi.fn().mockImplementation(async () => {
      order.push('sign-in')
      return {
        data: {
          user: { id: 'user-1' },
          session: { access_token: 'session-token' }
        },
        error: null
      }
    })
  }
  const bucket = {
    upload: vi.fn().mockImplementation(async (_path: string, file: File) => {
      order.push(`upload:${file.type}`)
      return {
        data: {
          id: 'cloud://env/input.jpg',
          path: 'wanxiang/input/input.jpg',
          fullPath: 'wanxiang/input/input.jpg'
        },
        error: null
      }
    }),
    download: vi.fn().mockResolvedValue({
      data: new Blob(['generated'], { type: 'image/jpeg' }),
      error: null
    }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null })
  }
  const callFunction = vi
    .fn()
    .mockResolvedValueOnce({
      requestId: 'request-1',
      result: { success: true, status: 'PENDING', taskId: 'task-1' }
    })
    .mockResolvedValueOnce({
      requestId: 'request-2',
      result: {
        success: true,
        status: 'SUCCEEDED',
        fileID: 'cloud://env/output.jpg'
      }
    })

  const app = {
    auth: Object.assign(() => auth, auth),
    callFunction,
    storage: {
      from: () => bucket
    }
  } as unknown as CloudBaseWebApp

  return { app, auth, bucket, callFunction, order }
}

afterEach(() => {
  registerStyleTransferAdapter(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Wanxiang CloudBase H5 adapter', () => {
  it('fails closed when the public CloudBase environment is not configured', async () => {
    const sdk = { init: vi.fn() } as unknown as CloudBaseWebSdk

    expect(
      initializeWanxiangCloudBaseH5({
        runtimeEnv: 'h5',
        envId: '',
        sdk
      })
    ).toBe(false)
    expect(sdk.init).not.toHaveBeenCalled()
    await expect(
      transformImageStyle({
        filePath: 'blob:input',
        fileName: 'input.jpg',
        fields: { style_index: '34', style_transfer: 'wanxiang' }
      })
    ).rejects.toThrow('万相 CloudBase 环境未配置')
  })

  it('authenticates lazily, maps Web storage/functions and caches one paid result', async () => {
    const { app, auth, bucket, callFunction, order } = createWebApp()
    const sdk = {
      init: vi.fn().mockReturnValue(app)
    } as unknown as CloudBaseWebSdk

    class MockImage {
      naturalWidth = 1024
      naturalHeight = 1024
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        new Response(new Blob(['source'], { type: 'image/jpeg' }), {
          status: 200
        })
      )
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:wanxiang-output')

    expect(
      initializeWanxiangCloudBaseH5({
        runtimeEnv: 'h5',
        envId: 'env-test',
        region: 'ap-shanghai',
        sdk,
        pollIntervalMs: 0,
        maxPollAttempts: 1
      })
    ).toBe(true)
    expect(sdk.init).not.toHaveBeenCalled()
    expect(auth.getSession).not.toHaveBeenCalled()

    const input = {
      filePath: 'blob:input',
      fileName: 'input.jpg',
      fields: { style_index: '34', style_transfer: 'wanxiang' }
    }

    await expect(transformImageStyle({
      ...input,
      fileName: 'renamed-input.jpg'
    })).resolves.toEqual({
      filePath: 'blob:wanxiang-output',
      fileName: 'renamed-input.jpg',
      generatedImage: 'cloud://env/output.jpg'
    })

    expect(sdk.init).toHaveBeenCalledWith({
      env: 'env-test',
      region: 'ap-shanghai'
    })
    await expect(transformImageStyle(input)).resolves.toEqual({
      filePath: 'blob:wanxiang-output',
      fileName: 'input.jpg',
      generatedImage: 'cloud://env/output.jpg'
    })

    expect(order.slice(0, 3)).toEqual([
      'get-session',
      'sign-in',
      'upload:image/jpeg'
    ])
    expect(bucket.upload).toHaveBeenCalledTimes(1)
    expect(bucket.remove).toHaveBeenCalledWith(['cloud://env/input.jpg'])
    expect(bucket.download).toHaveBeenCalledWith('cloud://env/output.jpg')
    expect(callFunction).toHaveBeenCalledTimes(2)
    expect(callFunction).toHaveBeenNthCalledWith(1, {
      name: 'submitStyleTransfer',
      data: { fileID: 'cloud://env/input.jpg', styleIndex: 34 },
      parse: true
    })
  })
})
