import Taro from '@tarojs/taro'

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function readPersistedState<T>(key: string, fallback: T): T {
  try {
    const value = Taro.getStorageSync(key)
    if (value == null || value === '') {
      return fallback
    }
    return value as T
  } catch {
    return fallback
  }
}

export function writePersistedState<T>(key: string, value: T) {
  try {
    Taro.setStorageSync(key, value)
    return true
  } catch {
    return false
  }
}

export function ensurePersistedString(key: string, fallbackPrefix: string) {
  const existing = readPersistedState<string>(key, '')
  if (existing.trim()) {
    return existing.trim()
  }

  const next = createId(fallbackPrefix)
  writePersistedState(key, next)
  return next
}
