import { afterEach, describe, expect, it, vi } from 'vitest'

const getEnvMock = vi.hoisted(() => vi.fn())

vi.mock('@tarojs/taro', () => ({
  default: {
    ENV_TYPE: {
      WEB: 'WEB',
      WEAPP: 'WEAPP',
      RN: 'RN'
    },
    getEnv: getEnvMock
  }
}))

import { getApiBaseUrl, getApiBaseUrlByEnv } from '../env'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('env helpers', () => {
  it('returns empty base url in h5 runtime', () => {
    getEnvMock.mockReturnValue('WEB')
    vi.stubEnv('TARO_APP_API_BASE_URL', 'https://example.com')

    expect(getApiBaseUrl()).toBe('')
  })

  it('returns configured base url outside h5 runtime', () => {
    getEnvMock.mockReturnValue('WEAPP')
    vi.stubEnv('TARO_APP_API_BASE_URL', 'https://example.com')

    expect(getApiBaseUrl()).toBe('https://example.com')
  })

  it('falls back to localhost base url in weapp runtime', () => {
    getEnvMock.mockReturnValue('WEAPP')
    vi.stubGlobal('process', undefined)

    expect(getApiBaseUrl()).toBe('https://beadcraft.cvalab.top')
  })

  it('keeps rn fallback aligned to emulator host', () => {
    expect(getApiBaseUrlByEnv('rn')).toBe('http://10.0.2.2:8765')
  })

  it('does not throw when process is unavailable in h5 runtime', () => {
    getEnvMock.mockReturnValue('WEB')
    vi.stubGlobal('process', undefined)

    expect(getApiBaseUrl()).toBe('')
  })
})
