import { getRuntimeEnv } from '@/utils/runtime-env'
import {
  registerStyleTransferAdapter,
  type StyleTransferAdapter,
  type StyleTransferInput
} from './style-transfer'
import {
  createWanxiangCloudBaseAdapter,
  type WanxiangCloudBaseAdapterOptions,
  type WanxiangCloudBaseClient
} from './wanxiang-cloudbase'

interface CloudBaseBuildConfig {
  envId?: string
  region?: string
  accessKey?: string
}

declare const __PIXELDOODLE_CLOUDBASE_BUILD_CONFIG__:
  | CloudBaseBuildConfig
  | undefined

type CloudBaseConfigGlobal = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}

interface CloudBaseWebAuth {
  getSession(): Promise<{
    data?: { session?: unknown | null } | null
    error?: { message?: string } | null
  }>
  signInAnonymously(): Promise<{
    data?: { session?: unknown | null } | null
    error?: { message?: string } | null
  }>
}

interface CloudBaseWebBucket {
  upload(
    path: string,
    file: File,
    options?: { contentType?: string; upsert?: boolean }
  ): Promise<{
    data: { id: string } | null
    error: { message?: string } | null
  }>
  download(path: string): Promise<{
    data: Blob | null
    error: { message?: string } | null
  }>
  remove(paths: string[]): Promise<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface CloudBaseWebApp {
  auth: (() => CloudBaseWebAuth) & CloudBaseWebAuth
  callFunction(options: {
    name: string
    data: Record<string, unknown>
    parse: boolean
  }): Promise<{ result?: unknown }>
  storage: {
    from(): CloudBaseWebBucket
  }
}

export interface CloudBaseWebSdk {
  init(options: {
    env: string
    region?: string
    accessKey?: string
  }): CloudBaseWebApp
}

export interface InitializeWanxiangCloudBaseH5Options
  extends WanxiangCloudBaseAdapterOptions {
  runtimeEnv?: string
  envId?: string
  region?: string
  accessKey?: string
  sdk?: CloudBaseWebSdk
  app?: CloudBaseWebApp
}

function buildCloudBaseConfig(options: InitializeWanxiangCloudBaseH5Options) {
  const buildConfig =
    typeof __PIXELDOODLE_CLOUDBASE_BUILD_CONFIG__ === 'undefined'
      ? {}
      : __PIXELDOODLE_CLOUDBASE_BUILD_CONFIG__
  const runtimeEnv = (globalThis as CloudBaseConfigGlobal).process?.env
  const env = String(
    options.envId ??
      runtimeEnv?.TARO_APP_CLOUDBASE_ENV_ID ??
      buildConfig.envId ??
      ''
  ).trim()
  const region = String(
    options.region ??
      runtimeEnv?.TARO_APP_CLOUDBASE_REGION ??
      buildConfig.region ??
      'ap-shanghai'
  ).trim()
  const accessKey = String(
    options.accessKey ??
      runtimeEnv?.TARO_APP_CLOUDBASE_ACCESS_KEY ??
      buildConfig.accessKey ??
      ''
  ).trim()

  return {
    env,
    ...(region ? { region } : {}),
    ...(accessKey ? { accessKey } : {})
  }
}

function unavailableAdapter(message: string): StyleTransferAdapter {
  return {
    async transform() {
      throw new Error(message)
    }
  }
}

function webErrorDetail(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return ''
}

function storageErrorMessage(error: { message?: string } | null) {
  return error?.message?.trim() || ''
}

async function readBlob(filePath: string) {
  const response = await fetch(filePath)
  if (!response.ok) {
    throw new Error(`图片读取失败（${response.status}）`)
  }
  return response.blob()
}

function readImageInfo(filePath: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      })
    }
    image.onerror = () => reject(new Error('无法读取图片尺寸'))
    image.src = filePath
  })
}

function createEnsureAuthenticated(app: CloudBaseWebApp) {
  let ready: Promise<void> | null = null

  return () => {
    if (!ready) {
      ready = (async () => {
        const auth = app.auth()
        const current = await auth.getSession()
        if (current?.error) {
          throw new Error(current.error.message || '登录状态读取失败')
        }
        if (current?.data?.session) {
          return
        }

        const result = await auth.signInAnonymously()
        if (result?.error) {
          throw new Error(result.error.message || '匿名登录失败')
        }
        if (!result?.data?.session) {
          throw new Error('匿名登录未返回有效会话')
        }
      })().catch((error) => {
        ready = null
        const detail = webErrorDetail(error)
        throw new Error(
          `万相云服务登录失败${detail ? `：${detail}` : '，请检查 CloudBase 登录配置'}`
        )
      })
    }

    return ready
  }
}

export function createWanxiangCloudBaseH5Client(
  app: CloudBaseWebApp
): WanxiangCloudBaseClient {
  const bucket = app.storage.from()
  const ensureAuthenticated = createEnsureAuthenticated(app)

  return {
    async getImageInfo(filePath) {
      return readImageInfo(filePath)
    },
    async getFileInfo(filePath) {
      const blob = await readBlob(filePath)
      return { size: blob.size }
    },
    async uploadFile({ cloudPath, filePath }) {
      await ensureAuthenticated()
      const blob = await readBlob(filePath)
      const fileName = cloudPath.split('/').pop() || 'input.jpg'
      const file = new File([blob], fileName, {
        type: blob.type || 'application/octet-stream'
      })
      const { data, error } = await bucket.upload(cloudPath, file, {
        contentType: file.type,
        upsert: false
      })
      if (error || !data?.id) {
        const detail = storageErrorMessage(error)
        throw new Error(detail || 'CloudBase 云存储未返回文件编号')
      }
      return { fileID: data.id }
    },
    async callFunction({ name, data }) {
      await ensureAuthenticated()
      return app.callFunction({ name, data, parse: true })
    },
    async deleteFile(fileIDs) {
      await ensureAuthenticated()
      const { data, error } = await bucket.remove(fileIDs)
      if (error) {
        throw new Error(storageErrorMessage(error) || 'CloudBase 文件删除失败')
      }
      return data
    },
    async downloadFile(fileID) {
      await ensureAuthenticated()
      const { data, error } = await bucket.download(fileID)
      if (error || !(data instanceof Blob)) {
        const detail = storageErrorMessage(error)
        throw new Error(detail || 'CloudBase 云存储未返回图片')
      }
      return { tempFilePath: URL.createObjectURL(data) }
    }
  }
}

function cacheKey(input: StyleTransferInput) {
  return [input.filePath, input.fields.style_index || ''].join('\u0000')
}

function cachePaidResults(adapter: StyleTransferAdapter): StyleTransferAdapter {
  const maxEntries = 8
  const cache = new Map<
    string,
    {
      promise: ReturnType<StyleTransferAdapter['transform']>
      result?: Awaited<ReturnType<StyleTransferAdapter['transform']>>
    }
  >()

  const evictOldestSettledResult = (protectedKey?: string) => {
    if (cache.size < maxEntries) {
      return
    }

    for (const [key, entry] of cache) {
      if (key === protectedKey || !entry.result) {
        continue
      }
      cache.delete(key)
      if (entry.result.filePath.startsWith('blob:')) {
        URL.revokeObjectURL(entry.result.filePath)
      }
      return
    }
  }

  const trimSettledResults = (protectedKey: string) => {
    while (cache.size > maxEntries) {
      const previousSize = cache.size
      evictOldestSettledResult(protectedKey)
      if (cache.size === previousSize) {
        return
      }
    }
  }

  const forCaller = (
    promise: ReturnType<StyleTransferAdapter['transform']>,
    input: StyleTransferInput
  ) => promise.then((result) => ({ ...result, fileName: input.fileName }))

  return {
    transform(input) {
      const key = cacheKey(input)
      const cached = cache.get(key)
      if (cached) {
        return forCaller(cached.promise, input)
      }

      evictOldestSettledResult()
      const entry: {
        promise: ReturnType<StyleTransferAdapter['transform']>
        result?: Awaited<ReturnType<StyleTransferAdapter['transform']>>
      } = {
        promise: Promise.resolve({ filePath: input.filePath })
      }
      entry.promise = adapter
        .transform(input)
        .then((result) => {
          entry.result = result
          trimSettledResults(key)
          return result
        })
        .catch((error) => {
          cache.delete(key)
          throw error
        })
      cache.set(key, entry)
      return forCaller(entry.promise, input)
    }
  }
}

function createCloudBaseAppLoader(
  config: { env: string; region?: string; accessKey?: string },
  options: InitializeWanxiangCloudBaseH5Options
) {
  let appPromise: Promise<CloudBaseWebApp> | null = null

  return () => {
    if (!appPromise) {
      appPromise = (async () => {
        if (options.app) {
          return options.app
        }

        const sdk = options.sdk ?? await import('@cloudbase/js-sdk').then((module) => {
          return ((module as { default?: unknown }).default ?? module) as CloudBaseWebSdk
        })
        return sdk.init(config)
      })().catch((error) => {
        appPromise = null
        const detail = webErrorDetail(error)
        throw new Error(
          `万相 CloudBase 初始化失败${detail ? `：${detail}` : '，请检查环境配置'}`
        )
      })
    }

    return appPromise
  }
}

function createLazyWanxiangClient(
  loadApp: () => Promise<CloudBaseWebApp>
): WanxiangCloudBaseClient {
  let clientPromise: Promise<WanxiangCloudBaseClient> | null = null

  const getClient = () => {
    if (!clientPromise) {
      clientPromise = loadApp()
        .then(createWanxiangCloudBaseH5Client)
        .catch((error) => {
          clientPromise = null
          throw error
        })
    }
    return clientPromise
  }

  return {
    async getImageInfo(filePath) {
      return readImageInfo(filePath)
    },
    async getFileInfo(filePath) {
      const blob = await readBlob(filePath)
      return { size: blob.size }
    },
    async uploadFile(input) {
      return (await getClient()).uploadFile(input)
    },
    async callFunction(input) {
      return (await getClient()).callFunction(input)
    },
    async deleteFile(fileIDs) {
      return (await getClient()).deleteFile(fileIDs)
    },
    async downloadFile(fileID) {
      return (await getClient()).downloadFile(fileID)
    }
  }
}

export function initializeWanxiangCloudBaseH5(
  options: InitializeWanxiangCloudBaseH5Options = {}
) {
  if (getRuntimeEnv(options.runtimeEnv) !== 'h5') {
    return false
  }

  const config = buildCloudBaseConfig(options)
  if (!config.env) {
    registerStyleTransferAdapter(
      unavailableAdapter('万相 CloudBase 环境未配置，请设置 TARO_APP_CLOUDBASE_ENV_ID')
    )
    return false
  }

  const client = createLazyWanxiangClient(createCloudBaseAppLoader(config, options))
  const adapter = createWanxiangCloudBaseAdapter(client, options)
  registerStyleTransferAdapter(cachePaidResults(adapter))
  return true
}
