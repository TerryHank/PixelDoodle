import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: storage.getStorageSync,
    setStorageSync: storage.setStorageSync
  }
}))

import { createEmptyDeviceMonitorSnapshot } from '@/domain/device-monitoring'
import { useDeviceMonitorStore } from '@/store/device-monitor-store'
import {
  reportBleAck,
  reportBleNack,
  reportDeviceConnection,
  reportDeviceHeartbeat,
  reportWifiTimeout,
  startDeviceOfflineMonitor
} from './device-monitoring-service'

describe('device monitoring service', () => {
  beforeEach(() => {
    storage.getStorageSync.mockReset()
    storage.setStorageSync.mockReset()
    useDeviceMonitorStore.setState(createEmptyDeviceMonitorSnapshot())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts connection and heartbeat events from adapters', () => {
    reportDeviceConnection({
      deviceId: 'ble-001',
      transport: 'ble',
      state: 'connecting',
      at: 100
    })
    reportDeviceHeartbeat({
      deviceId: 'ble-001',
      transport: 'ble',
      at: 200,
      telemetry: {
        uptimeSeconds: 42,
        brightness: 64
      }
    })

    expect(useDeviceMonitorStore.getState().devices['BLE-001']).toMatchObject({
      connectionState: 'online',
      lastSeenAt: 200,
      lastHeartbeatAt: 200,
      telemetry: {
        uptimeSeconds: 42,
        brightness: 64
      }
    })
  })

  it('maps BLE ACK/NACK and WiFi timeout to standard monitor events', () => {
    reportBleNack({
      deviceId: 'device-transport',
      operation: '图像发送',
      at: 100
    })
    reportWifiTimeout({
      deviceId: 'device-wifi',
      operation: '图像发送',
      at: 200,
      message: '设备不可达'
    })

    expect(
      useDeviceMonitorStore.getState().alerts.map((alert) => [
        alert.deviceId,
        alert.code
      ])
    ).toEqual([
      ['DEVICE-WIFI', 'TRANSPORT_TIMEOUT'],
      ['DEVICE-TRANSPORT', 'TRANSPORT_NACK']
    ])

    reportBleAck({
      deviceId: 'device-transport',
      operation: '图像发送',
      at: 300
    })
    expect(
      useDeviceMonitorStore
        .getState()
        .alerts.find((alert) => alert.deviceId === 'DEVICE-TRANSPORT')
        ?.resolvedAt
    ).toBe(300)
  })

  it('runs deterministic periodic offline evaluation', () => {
    vi.useFakeTimers()
    let now = 1_000
    reportDeviceHeartbeat({
      deviceId: 'device-timer',
      transport: 'wifi',
      at: now
    })
    const stop = startDeviceOfflineMonitor({
      timeoutMs: 3_000,
      intervalMs: 1_000,
      now: () => now,
      evaluateImmediately: false
    })

    now = 3_999
    vi.advanceTimersByTime(1_000)
    expect(useDeviceMonitorStore.getState().devices['DEVICE-TIMER'].connectionState).toBe(
      'online'
    )

    now = 4_000
    vi.advanceTimersByTime(1_000)
    expect(useDeviceMonitorStore.getState().devices['DEVICE-TIMER'].connectionState).toBe(
      'offline'
    )
    expect(useDeviceMonitorStore.getState().alerts[0].code).toBe('HEARTBEAT_TIMEOUT')

    stop()
  })
})
