import Taro from '@tarojs/taro'

import { getRuntimeEnv } from '@/utils/runtime-env'
import {
  registerStyleTransferAdapter,
  type StyleTransferAdapter,
  type StyleTransferInput
} from './style-transfer'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_MAX_POLL_ATTEMPTS = 60
const DEFAULT_STYLE_INDEX = 34
const ALLOWED_STYLE_INDEXES = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15,
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
])

interface ImageInfo {
  width: number
  height: number
}

interface FileInfo {
  size: number
}

interface UploadResult {
  fileID: string
}

interface DownloadResult {
  tempFilePath: string
}

interface CloudFunctionCall {
  name: 'submitStyleTransfer' | 'queryStyleTransfer'
  data: Record<string, unknown>
}

interface CloudFunctionResult {
  result?: unknown
}

export interface WanxiangCloudBaseClient {
  getImageInfo(filePath: string): Promise<ImageInfo>
  getFileInfo(filePath: string): Promise<FileInfo>
  uploadFile(options: { cloudPath: string; filePath: string }): Promise<UploadResult>
  callFunction(options: CloudFunctionCall): Promise<CloudFunctionResult>
  deleteFile(fileIDs: string[]): Promise<unknown>
  downloadFile(fileID: string): Promise<DownloadResult>
}

export interface WanxiangCloudBaseAdapterOptions {
  pollIntervalMs?: number
  maxPollAttempts?: number
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  random?: () => string
}

interface TaroCloudApi {
  init(config?: { traceUser?: boolean }): void
  uploadFile(options: { cloudPath: string; filePath: string }): Promise<UploadResult>
  callFunction(options: CloudFunctionCall): Promise<CloudFunctionResult>
  deleteFile(options: { fileList: string[] }): Promise<unknown>
  downloadFile(options: { fileID: string }): Promise<DownloadResult>
}

export interface InitializeWanxiangCloudBaseOptions
  extends WanxiangCloudBaseAdapterOptions {
  runtimeEnv?: string
  cloud?: TaroCloudApi
  client?: WanxiangCloudBaseClient
}

type CloudPayload = Record<string, unknown>

function registerUnavailableCloudBaseAdapter(message: string) {
  registerStyleTransferAdapter({
    async transform() {
      throw new Error(message)
    }
  })
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function errorDetail(error: unknown) {
  return error instanceof Error && error.message ? error.message : ''
}

function unwrapCloudPayload(response: CloudFunctionResult): CloudPayload {
  if (!response.result || typeof response.result !== 'object') {
    throw new Error('云函数返回的数据格式无效')
  }

  return response.result as CloudPayload
}

function readString(payload: CloudPayload, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function taskFailure(payload: CloudPayload) {
  const detail =
    readString(payload, 'message', 'code') || '云端任务执行失败，请稍后重试'
  return new Error(`万相生成失败：${detail}`)
}

async function validateInputImage(
  client: WanxiangCloudBaseClient,
  filePath: string
) {
  let imageInfo: ImageInfo
  let fileInfo: FileInfo

  try {
    ;[imageInfo, fileInfo] = await Promise.all([
      client.getImageInfo(filePath),
      client.getFileInfo(filePath)
    ])
  } catch {
    throw new Error('无法读取图片信息，请重新选择图片')
  }

  const width = Number(imageInfo.width)
  const height = Number(imageInfo.height)
  const size = Number(fileInfo.size)
  if (![width, height, size].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('无法读取有效的图片尺寸或文件大小')
  }

  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)

  if (width < 256 || height < 256) {
    throw new Error('图片宽高均不能小于 256 像素')
  }
  if (longEdge > 5760) {
    throw new Error('图片长边不能超过 5760 像素')
  }
  if (shortEdge > 3240) {
    throw new Error('图片短边不能超过 3240 像素')
  }
  if (longEdge / shortEdge > 2) {
    throw new Error('图片长短边比例不能超过 2:1')
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new Error('图片大小不能超过 10MB')
  }
}

function imageExtension(input: StyleTransferInput) {
  const source = input.fileName || input.filePath.split(/[\\/]/).pop() || ''
  const extension = source.split(/[?#]/, 1)[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]
  const supported = new Set(['jpg', 'jpeg', 'png', 'bmp', 'webp'])
  const normalized = String(extension || '').toLowerCase()
  return supported.has(normalized) ? normalized : 'jpg'
}

function uploadCloudPath(
  input: StyleTransferInput,
  now: () => number,
  random: () => string
) {
  const randomPart = random().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'image'
  return `wanxiang/input/${now()}-${randomPart}.${imageExtension(input)}`
}

function styleIndexOf(input: StyleTransferInput) {
  const styleIndex = Number(input.fields.style_index ?? DEFAULT_STYLE_INDEX)
  if (!Number.isInteger(styleIndex) || !ALLOWED_STYLE_INDEXES.has(styleIndex)) {
    throw new Error('万相风格编号无效，请重新选择风格')
  }
  return styleIndex
}

export function createWanxiangCloudBaseAdapter(
  client: WanxiangCloudBaseClient,
  options: WanxiangCloudBaseAdapterOptions = {}
): StyleTransferAdapter {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS
  const wait = options.sleep ?? sleep
  const now = options.now ?? Date.now
  const random = options.random ?? (() => Math.random().toString(36).slice(2))

  if (pollIntervalMs < 0 || !Number.isInteger(maxPollAttempts) || maxPollAttempts < 1) {
    throw new Error('万相轮询参数无效')
  }

  return {
    async transform(input) {
      await validateInputImage(client, input.filePath)
      const styleIndex = styleIndexOf(input)

      let upload: UploadResult
      try {
        upload = await client.uploadFile({
          cloudPath: uploadCloudPath(input, now, random),
          filePath: input.filePath
        })
      } catch {
        throw new Error('图片上传到云端失败，请检查云开发配置后重试')
      }

      let submitResponse: CloudFunctionResult
      try {
        submitResponse = await client.callFunction({
          name: 'submitStyleTransfer',
          data: { fileID: upload.fileID, styleIndex }
        })
      } catch (error) {
        const detail = errorDetail(error)
        throw new Error(`万相任务提交失败${detail ? `：${detail}` : '，请稍后重试'}`)
      } finally {
        try {
          await client.deleteFile([upload.fileID])
        } catch {
          // 输入图只用于提交任务；删除失败不应阻断已提交的生成任务。
        }
      }

      let submitPayload: CloudPayload
      try {
        submitPayload = unwrapCloudPayload(submitResponse)
      } catch (error) {
        throw new Error(`万相任务提交失败：${errorDetail(error)}`)
      }
      if (submitPayload.success === false || readString(submitPayload, 'status') === 'FAILED') {
        throw taskFailure(submitPayload)
      }

      const taskId = readString(submitPayload, 'taskId', 'task_id')
      if (!taskId) {
        throw new Error('万相任务提交失败：云函数未返回任务编号')
      }

      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        let queryPayload: CloudPayload
        try {
          const queryResponse = await client.callFunction({
            name: 'queryStyleTransfer',
            data: { taskId }
          })
          queryPayload = unwrapCloudPayload(queryResponse)
        } catch (error) {
          const detail = errorDetail(error)
          throw new Error(`万相任务查询失败${detail ? `：${detail}` : '，请稍后重试'}`)
        }

        const status = readString(queryPayload, 'status').toUpperCase()
        if (queryPayload.success === false || status === 'FAILED') {
          throw taskFailure(queryPayload)
        }

        if (status === 'SUCCEEDED') {
          const outputFileID = readString(
            queryPayload,
            'fileID',
            'file_id',
            'output_file_id'
          )
          if (!outputFileID) {
            throw new Error('万相生成失败：云函数未返回生成图片')
          }

          try {
            const download = await client.downloadFile(outputFileID)
            return {
              filePath: download.tempFilePath,
              fileName: input.fileName,
              generatedImage: outputFileID
            }
          } catch {
            throw new Error('万相生成图片下载失败，请稍后重试')
          }
        }

        if (status !== 'PENDING' && status !== 'RUNNING') {
          throw new Error('万相任务查询失败：云函数返回了未知状态')
        }

        if (attempt + 1 < maxPollAttempts) {
          await wait(pollIntervalMs)
        }
      }

      throw new Error('万相生成超时，请稍后重试')
    }
  }
}

function createTaroCloudBaseClient(cloud: TaroCloudApi): WanxiangCloudBaseClient {
  return {
    async getImageInfo(filePath) {
      const result = await Taro.getImageInfo({ src: filePath })
      return { width: result.width, height: result.height }
    },
    async getFileInfo(filePath) {
      const result = await Taro.getFileInfo({ filePath })
      if ('size' in result) {
        return { size: result.size }
      }
      throw new Error(result.errMsg)
    },
    uploadFile: (options) => cloud.uploadFile(options),
    callFunction: (options) => cloud.callFunction(options),
    deleteFile: (fileIDs) => cloud.deleteFile({ fileList: fileIDs }),
    downloadFile: (fileID) => cloud.downloadFile({ fileID })
  }
}

export function initializeWanxiangCloudBase(
  options: InitializeWanxiangCloudBaseOptions = {}
) {
  if (getRuntimeEnv(options.runtimeEnv) !== 'weapp') {
    return false
  }

  const cloud =
    options.cloud ?? (Taro as unknown as { cloud?: TaroCloudApi }).cloud
  if (!cloud) {
    registerUnavailableCloudBaseAdapter('微信云开发不可用，请检查小程序基础库配置')
    return false
  }

  try {
    cloud.init({ traceUser: true })
  } catch {
    registerUnavailableCloudBaseAdapter('微信云开发初始化失败，请检查 CloudBase 环境配置')
    return false
  }
  const client = options.client ?? createTaroCloudBaseClient(cloud)
  registerStyleTransferAdapter(createWanxiangCloudBaseAdapter(client, options))
  return true
}
