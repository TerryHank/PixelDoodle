import Taro from '@tarojs/taro'

export type RuntimeEnv = 'h5' | 'weapp' | 'rn'

export function normalizeRuntimeEnv(env?: string | null): RuntimeEnv {
  const normalized = String(env || '').trim().toUpperCase()

  if (normalized === 'RN') {
    return 'rn'
  }

  if (normalized === 'WEAPP') {
    return 'weapp'
  }

  return 'h5'
}

export function getRuntimeEnv(explicit?: string | null): RuntimeEnv {
  if (explicit) {
    return normalizeRuntimeEnv(explicit)
  }

  const taroEnv =
    typeof Taro.getEnv === 'function' ? String(Taro.getEnv()) : undefined

  if (taroEnv) {
    return normalizeRuntimeEnv(taroEnv)
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'h5'
  }

  const processEnv =
    typeof globalThis !== 'undefined'
      ? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.TARO_ENV
      : undefined

  return normalizeRuntimeEnv(processEnv)
}
