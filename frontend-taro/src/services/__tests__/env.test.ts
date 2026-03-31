import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApiBaseUrl } from '../env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('env helpers', () => {
  it('returns empty base url in h5 runtime', () => {
    vi.stubEnv('TARO_ENV', 'h5')
    vi.stubEnv('TARO_APP_API_BASE_URL', 'https://example.com')

    expect(getApiBaseUrl()).toBe('')
  })

  it('returns configured base url outside h5 runtime', () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_API_BASE_URL', 'https://example.com')

    expect(getApiBaseUrl()).toBe('https://example.com')
  })
})
