import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: storageMocks
}))

import { readPersistedState, writePersistedState } from './persistence'

describe('persistence helpers', () => {
  beforeEach(() => {
    storageMocks.getStorageSync.mockReset()
    storageMocks.setStorageSync.mockReset()
  })

  it('reports a successful write', () => {
    expect(writePersistedState('draft', { value: 1 })).toBe(true)
    expect(storageMocks.setStorageSync).toHaveBeenCalledWith('draft', { value: 1 })
  })

  it('reports a failed write without crashing the in-memory flow', () => {
    storageMocks.setStorageSync.mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(writePersistedState('draft', { value: 1 })).toBe(false)
  })

  it('returns the fallback when reading storage fails', () => {
    storageMocks.getStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    expect(readPersistedState('draft', { value: 0 })).toEqual({ value: 0 })
  })
})
