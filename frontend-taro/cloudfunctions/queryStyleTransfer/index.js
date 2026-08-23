'use strict'

const DEFAULT_API_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024
const DASHSCOPE_RESULT_HOST = /^dashscope-result-[a-z0-9-]+\.oss-cn-[a-z0-9-]+\.aliyuncs\.com$/i

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

function validateTaskId(event) {
  const taskId = event && event.taskId
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) {
    throw new FunctionError('INVALID_TASK_ID', 'A valid taskId is required')
  }
  return taskId
}

function validateResultUrl(value) {
  let resultUrl
  try {
    resultUrl = new URL(value)
  } catch (_error) {
    throw new FunctionError('DASHSCOPE_RESULT_URL_INVALID', 'DashScope returned an invalid result URL')
  }
  if (
    resultUrl.protocol !== 'https:' ||
    resultUrl.username ||
    resultUrl.password ||
    (resultUrl.port && resultUrl.port !== '443') ||
    !DASHSCOPE_RESULT_HOST.test(resultUrl.hostname)
  ) {
    throw new FunctionError('DASHSCOPE_RESULT_URL_UNTRUSTED', 'DashScope returned an untrusted result URL')
  }
  return resultUrl.toString()
}

function safeProviderText(value, apiKey, fallback) {
  let result = typeof value === 'string' && value.trim() ? value.trim() : fallback
  if (apiKey) result = result.split(apiKey).join('[REDACTED]')
  result = result.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
  return result.slice(0, 500)
}

function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new FunctionError('INVALID_RESULT_IMAGE', 'DashScope returned an empty image')
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaType: 'image/jpeg', extension: 'jpg' }
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mediaType: 'image/png', extension: 'png' }
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { mediaType: 'image/bmp', extension: 'bmp' }
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mediaType: 'image/webp', extension: 'webp' }
  }
  throw new FunctionError('UNSUPPORTED_RESULT_IMAGE', 'DashScope returned an unsupported image type')
}

async function handleQueryStyleTransfer(event, _context, dependencies) {
  const taskId = validateTaskId(event)
  const { cloud, http, env = process.env } = dependencies || {}
  const apiKey = String(env.DASHSCOPE_API_KEY || '').trim()

  if (!apiKey) {
    throw new FunctionError('DASHSCOPE_NOT_CONFIGURED', 'DashScope is not configured')
  }
  if (!cloud || typeof cloud.uploadFile !== 'function' || !http || typeof http.get !== 'function') {
    throw new FunctionError('DEPENDENCY_ERROR', 'Cloud function dependencies are unavailable')
  }

  let response
  try {
    response = await http.get(
      `${normalizeBaseUrl(env.DASHSCOPE_API_BASE_URL)}/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000
      }
    )
  } catch (error) {
    const requestId = getRequestId(error && error.response && error.response.data)
    throw new FunctionError('DASHSCOPE_QUERY_FAILED', 'DashScope task query failed', requestId)
  }

  const payload = response && response.data
  const output = (payload && payload.output) || {}
  const status = String(output.task_status || 'UNKNOWN').toUpperCase()
  const requestId = getRequestId(payload)

  if (status === 'PENDING' || status === 'RUNNING') {
    return withRequestId({ success: true, status }, requestId)
  }

  if (status === 'FAILED') {
    const code = output.code || output.error_code
    const result = {
      success: false,
      status: 'FAILED',
      message: safeProviderText(
        output.message || output.error_message,
        apiKey,
        'DashScope style transfer failed'
      )
    }
    if (code) result.code = safeProviderText(String(code), apiKey, 'DASHSCOPE_FAILED')
    return withRequestId(result, requestId)
  }

  if (status !== 'SUCCEEDED') {
    throw new FunctionError('DASHSCOPE_UNKNOWN_STATUS', 'DashScope returned an unknown task status', requestId)
  }

  const results = Array.isArray(output.results) ? output.results : []
  const rawResultUrl = results[0] && (results[0].result_url || results[0].url)
  if (typeof rawResultUrl !== 'string' || rawResultUrl === '') {
    throw new FunctionError('DASHSCOPE_RESULT_MISSING', 'DashScope result image is missing', requestId)
  }
  const resultUrl = validateResultUrl(rawResultUrl)

  let imageResponse
  try {
    imageResponse = await http.get(resultUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: MAX_OUTPUT_BYTES,
      maxBodyLength: MAX_OUTPUT_BYTES
    })
  } catch (_error) {
    throw new FunctionError('RESULT_DOWNLOAD_FAILED', 'Unable to download the result image', requestId)
  }

  const imageBytes = Buffer.from(imageResponse && imageResponse.data ? imageResponse.data : [])
  if (imageBytes.length > MAX_OUTPUT_BYTES) {
    throw new FunctionError('RESULT_IMAGE_TOO_LARGE', 'DashScope result image exceeds the 20MB limit', requestId)
  }
  const { mediaType, extension } = detectImageType(imageBytes)
  const cloudPath = `wanxiang/output/${taskId}.${extension}`

  let upload
  try {
    upload = await cloud.uploadFile({ cloudPath, fileContent: imageBytes })
  } catch (_error) {
    throw new FunctionError('CLOUD_UPLOAD_FAILED', 'Unable to save the result image', requestId)
  }

  const fileID = upload && upload.fileID
  if (typeof fileID !== 'string' || fileID === '') {
    throw new FunctionError('CLOUD_UPLOAD_INVALID_RESPONSE', 'Cloud storage did not return a fileID', requestId)
  }

  return withRequestId({ success: true, status: 'SUCCEEDED', fileID, mediaType }, requestId)
}

function createDefaultDependencies() {
  const cloud = require('wx-server-sdk')
  const http = require('axios')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  return { cloud, http, env: process.env }
}

exports.FunctionError = FunctionError
exports.detectImageType = detectImageType
exports.validateResultUrl = validateResultUrl
exports.handleQueryStyleTransfer = handleQueryStyleTransfer
exports.main = async (event, context) =>
  handleQueryStyleTransfer(event, context, createDefaultDependencies())
