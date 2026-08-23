import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    getStorageSync: vi.fn((key: string) => values.get(key)),
    setStorageSync: vi.fn((key: string, value: unknown) => values.set(key, value))
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: storage.getStorageSync,
    setStorageSync: storage.setStorageSync
  }
}))

import { createEmptyDeviceMonitorSnapshot } from '@/domain/device-monitoring'
import {
  DEVICE_MONITOR_STORAGE_KEY,
  useDeviceMonitorStore
} from './device-monitor-store'

describe('device monitor store', () => {
  beforeEach(() => {
    storage.values.clear()
    storage.getStorageSync.mockClear()
    storage.setStorageSync.mockClear()
    useDeviceMonitorStore.setState(createEmptyDeviceMonitorSnapshot())
  })

  it('persists device state, alerts and local history', () => {
    useDeviceMonitorStore.getState().recordEvent({
      type: 'fault',
      deviceId: 'DEVICE-STORE',
      transport: 'wifi',
      at: 100,
      code: 'UNDER_VOLTAGE'
    })

    const persisted = storage.values.get(DEVICE_MONITOR_STORAGE_KEY) as {
      version: number
      snapshot: ReturnType<typeof createEmptyDeviceMonitorSnapshot>
    }
    expect(persisted.version).toBe(1)
    expect(persisted.snapshot.devices['DEVICE-STORE']).toBeDefined()
    expect(persisted.snapshot.alerts[0].code).toBe('UNDER_VOLTAGE')
    expect(persisted.snapshot.history[0].kind).toBe('fault')
  })

  it('acknowledges an alert and records that action in history', () => {
    useDeviceMonitorStore.getState().recordEvent({
      type: 'fault',
      deviceId: 'DEVICE-STORE',
      transport: 'ble',
      at: 100,
      code: 'HARDWARE_FAULT'
    })
    const alertId = useDeviceMonitorStore.getState().alerts[0].id

    useDeviceMonitorStore.getState().acknowledgeAlert(alertId, 200)

    expect(useDeviceMonitorStore.getState().alerts[0].acknowledgedAt).toBe(200)
    expect(useDeviceMonitorStore.getState().history[0].kind).toBe(
      'alert_acknowledged'
    )
  })

  it('clears local history without deleting device status or alerts', () => {
    useDeviceMonitorStore.getState().recordEvent({
      type: 'timeout',
      deviceId: 'DEVICE-STORE',
      transport: 'wifi',
      at: 100,
      operation: '图像发送'
    })

    useDeviceMonitorStore.getState().clearHistory()

    expect(useDeviceMonitorStore.getState().history).toEqual([])
    expect(useDeviceMonitorStore.getState().devices['DEVICE-STORE']).toBeDefined()
    expect(useDeviceMonitorStore.getState().alerts).toHaveLength(1)
  })
})
