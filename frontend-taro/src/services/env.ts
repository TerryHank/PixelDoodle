export function getApiBaseUrl() {
  return process.env.TARO_ENV === 'h5'
    ? ''
    : (process.env.TARO_APP_API_BASE_URL || '')
}

