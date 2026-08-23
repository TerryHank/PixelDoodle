'use strict'

const DEFAULT_API_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const MAX_INPUT_BYTES = 10 * 1024 * 1024
const ALLOWED_STYLE_INDEXES = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15,
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
])

class FunctionError extends Error {
  constructor(code, message, requestId) {
    super(message)
    this.name = 'FunctionError'
    this.code = code
    if (requestId) this.requestId = requestId
  }
}

function getRequestId(payload) {
  return payload && (payload.request_id || payload.requestId)
}

function withRequestId(result, requestId) {
  return requestId ? { ...result, requestId } : result
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}

function validateEvent(event) {
  const fileID = event && event.fileID
  const styleIndex = Number(event && event.styleIndex)

  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    throw new FunctionError('INVALID_FILE_ID', 'A CloudBase fileID is required')
  }
  if (!Number.isInteger(styleIndex) || !ALLOWED_STYLE_INDEXES.has(styleIndex)) {
    throw new FunctionError('UNSUPPORTED_STYLE_INDEX', 'Unsupported styleIndex')
  }

  return { fileID, styleIndex }
}

function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new FunctionError('INVALID_IMAGE', 'Image is empty')
  }
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new FunctionError('IMAGE_TOO_LARGE', 'Image exceeds the 10MB limit')
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  throw new FunctionError('UNSUPPORTED_IMAGE_TYPE', 'Only JPEG, PNG, BMP and WEBP are supported')
}

async function handleSubmitStyleTransfer(event, _context, dependencies) {
  const { fileID, styleIndex } = validateEvent(event)
  const { cloud, http, env = process.env } = dependencies || {}
  const apiKey = String(env.DASHSCOPE_API_KEY || '').trim()

  if (!apiKey) {
    throw new FunctionError('DASHSCOPE_NOT_CONFIGURED', 'DashScope is not configured')
  }
  if (!cloud || typeof cloud.downloadFile !== 'function' || !http || typeof http.post !== 'function') {
    throw new FunctionError('DEPENDENCY_ERROR', 'Cloud function dependencies are unavailable')
  }

  let download
  try {
    download = await cloud.downloadFile({ fileID })
  } catch (_error) {
    throw new FunctionError('CLOUD_DOWNLOAD_FAILED', 'Unable to download the source image')
  }

  const bytes = Buffer.from(download && download.fileContent ? download.fileContent : [])
  const mediaType = detectImageType(bytes)
  const dataUrl = `data:${mediaType};base64,${bytes.toString('base64')}`
  const url = `${normalizeBaseUrl(env.DASHSCOPE_API_BASE_URL)}/services/aigc/image-generation/generation`

  let response
  try {
    response = await http.post(
      url,
      {
        model: 'wanx-style-repaint-v1',
        input: {
          image_url: dataUrl,
          style_index: styleIndex
        }
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        },
        timeout: 30000
      }
    )
  } catch (error) {
    const requestId = getRequestId(error && error.response && error.response.data)
    throw new FunctionError('DASHSCOPE_SUBMIT_FAILED', 'DashScope submission failed', requestId)
  }

  const payload = response && response.data
  const output = (payload && payload.output) || {}
  const taskId = output.task_id || output.taskId
  const requestId = getRequestId(payload)
  if (!taskId) {
    throw new FunctionError('DASHSCOPE_INVALID_RESPONSE', 'DashScope did not return a task ID', requestId)
  }

  return withRequestId({ success: true, status: 'PENDING', taskId }, requestId)
}

function createDefaultDependencies() {
  const cloud = require('wx-server-sdk')
  const http = require('axios')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  return { cloud, http, env: process.env }
}

exports.FunctionError = FunctionError
exports.detectImageType = detectImageType
exports.handleSubmitStyleTransfer = handleSubmitStyleTransfer
exports.main = async (event, context) =>
  handleSubmitStyleTransfer(event, context, createDefaultDependencies())
