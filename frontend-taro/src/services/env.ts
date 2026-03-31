export function getApiBaseUrlByEnv(env?: string, explicit?: string) {
  if (env === 'rn') {
    return explicit || process.env.TARO_APP_API_BASE_URL || 'http://10.0.2.2:8765'
  }

  if (env === 'h5') {
    return ''
  }

  return process.env.TARO_APP_API_BASE_URL || ''
}

export function getApiBaseUrl() {
  return getApiBaseUrlByEnv(process.env.TARO_ENV, process.env.TARO_APP_API_BASE_URL)
}
