import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value)
  }
}))

import {
  ACCESS_TOKEN_STORAGE_KEY,
  clearPrivateApiAccessToken,
  getPrivateApiHeaders,
  setPrivateApiAccessToken
} from '../identity'

describe('private API identity headers', () => {
  beforeEach(() => storage.clear())

  it('uses the local user header in sandbox mode', () => {
    expect(getPrivateApiHeaders('user-123')).toEqual({
      'x-pixeldoodle-user-id': 'user-123'
    })
  })

  it('prefers an access token supplied by the production login provider', () => {
    expect(setPrivateApiAccessToken('token-123')).toBe(true)
    expect(storage.get(ACCESS_TOKEN_STORAGE_KEY)).toBe('token-123')
    expect(getPrivateApiHeaders('user-123')).toEqual({
      authorization: 'Bearer token-123'
    })

    clearPrivateApiAccessToken()
    expect(getPrivateApiHeaders('user-123')).toEqual({
      'x-pixeldoodle-user-id': 'user-123'
    })
  })
})
