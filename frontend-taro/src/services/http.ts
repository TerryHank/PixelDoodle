import Taro from '@tarojs/taro'
import type { ApiErrorResponse } from '../types/api'
import { getApiBaseUrl } from './env'

function getErrorMessage(statusCode: number, data: unknown) {
  if (data && typeof data === 'object') {
    const errorData = data as Partial<ApiErrorResponse>
    if (errorData.detail) {
      return errorData.detail
    }
    if (errorData.message) {
      return errorData.message
    }
  }

  return `Request failed with status ${statusCode}`
}

function isBusinessFailure(data: unknown) {
  return Boolean(
    data &&
      typeof data === 'object' &&
      'success' in data &&
      (data as { success?: unknown }).success === false
  )
}

export async function requestJson<TResponse>(
  url: string,
  options: Partial<Taro.request.Option<TResponse>> = {}
) {
  const response = await Taro.request<TResponse>({
    ...options,
    url: `${getApiBaseUrl()}${url}`
  })

  if (response.statusCode >= 400) {
    throw new Error(getErrorMessage(response.statusCode, response.data))
  }

  if (isBusinessFailure(response.data)) {
    throw new Error(getErrorMessage(response.statusCode, response.data))
  }

  return response.data
}
