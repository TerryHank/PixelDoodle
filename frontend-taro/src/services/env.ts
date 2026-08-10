import { getRuntimeEnv, normalizeRuntimeEnv } from '@/utils/runtime-env'

const DEFAULT_WEAPP_API_BASE_URL = 'https://beadcraft.cvalab.top'
const DEFAULT_RN_API_BASE_URL = 'http://10.0.2.2:8765'

type GlobalApiBaseUrl = typeof globalThis & {
  __PIXELDOODLE_API_BASE_URL__?: string
}

function readApiBaseUrlOverride() {
  const globalOverride = (globalThis as GlobalApiBaseUrl)
    .__PIXELDOODLE_API_BASE_URL__

  if (typeof globalOverride === 'string' && globalOverride.trim()) {
    return globalOverride.trim()
  }

  const processOverride =
    typeof globalThis !== 'undefined'
      ? (globalThis as { process?: { env?: Record<string, string> } }).process?.env
          ?.TARO_APP_API_BASE_URL
      : undefined

  return processOverride || ''
}

export function getApiBaseUrlByEnv(env?: string, explicit?: string) {
  const runtime = normalizeRuntimeEnv(env)
  const apiBaseUrl = explicit || readApiBaseUrlOverride()

  if (runtime === 'rn') {
    return apiBaseUrl || DEFAULT_RN_API_BASE_URL
  }

  if (runtime === 'h5') {
    return ''
  }

  return apiBaseUrl || DEFAULT_WEAPP_API_BASE_URL
}

export function getApiBaseUrl() {
  return getApiBaseUrlByEnv(getRuntimeEnv(), readApiBaseUrlOverride())
}
