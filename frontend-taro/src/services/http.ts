import Taro from '@tarojs/taro'
import { getApiBaseUrl } from './env'

export async function requestJson<TResponse>(
  url: string,
  options: Partial<Taro.request.Option<TResponse>> = {}
) {
  const response = await Taro.request<TResponse>({
    ...options,
    url: `${getApiBaseUrl()}${url}`
  })

  return response.data
}

