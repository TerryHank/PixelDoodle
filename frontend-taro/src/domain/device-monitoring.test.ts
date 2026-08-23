import { describe, expect, it } from 'vitest'

import {
  acknowledgeDeviceAlert,
  applyDeviceMonitorEvent,
  createEmptyDeviceMonitorSnapshot,
  evaluateDeviceOffline
} from './device-monitoring'

describe('device monitoring domain', () => {
  it('records heartbeat, last seen time and telemetry', () => {
    const next = applyDeviceMonitorEvent(createEmptyDeviceMonitorSnapshot(), {
      type: 'heartbeat',
      deviceId: 'abcd1234',
      transport: 'ble',
      at: 1_000,
      telemetry: {
        firmwareVersion: '1.2.3',
        temperatureC: 42
      }
    })

    expect(next.devices.ABCD1234).toMatchObject({
      connectionState: 'online',
      healthState: 'healthy',
      lastSeenAt: 1_000,
      lastHeartbeatAt: 1_000,
      telemetry: {
        firmwareVersion: '1.2.3',
        temperatureC: 42
      }
    })
    expect(next.history[0]).toMatchObject({
      kind: 'heartbeat',
      at: 1_000
    })
  })

  it('marks a silent device offline once and resolves that alert after recovery', () => {
    const online = applyDeviceMonitorEvent(createEmptyDeviceMonitorSnapshot(), {
      type: 'heartbeat',
      deviceId: 'DEVICE-1',
      transport: 'wifi',
      at: 1_000
    })

    const stillOnline = evaluateDeviceOffline(online, 3_999, 3_000)
    expect(stillOnline).toBe(online)

    const offline = evaluateDeviceOffline(online, 4_000, 3_000)
    expect(offline.devices['DEVICE-1'].connectionState).toBe('offline')
    expect(offline.alerts).toHaveLength(1)
    expect(offline.alerts[0]).toMatchObject({
      code: 'HEARTBEAT_TIMEOUT',
      occurrences: 1,
      resolvedAt: null
    })

    const unchanged = evaluateDeviceOffline(offline, 5_000, 3_000)
    expect(unchanged).toBe(offline)
    expect(unchanged.alerts[0].occurrences).toBe(1)

    const recovered = applyDeviceMonitorEvent(offline, {
      type: 'heartbeat',
      deviceId: 'DEVICE-1',
      transport: 'wifi',
      at: 6_000
    })
    expect(recovered.devices['DEVICE-1']).toMatchObject({
      connectionState: 'online',
      healthState: 'healthy',
      lastSeenAt: 6_000
    })
    expect(recovered.alerts[0].resolvedAt).toBe(6_000)
  })

  it('deduplicates, acknowledges and reopens device faults', () => {
    const first = applyDeviceMonitorEvent(createEmptyDeviceMonitorSnapshot(), {
      type: 'fault',
      deviceId: 'DEVICE-2',
      transport: 'ble',
      at: 10,
      code: 'OVER_TEMPERATURE'
    })
    const repeated = applyDeviceMonitorEvent(first, {
      type: 'fault',
      deviceId: 'DEVICE-2',
      transport: 'ble',
      at: 20,
      code: 'OVER_TEMPERATURE'
    })

    expect(repeated.alerts).toHaveLength(1)
    expect(repeated.alerts[0]).toMatchObject({
      severity: 'critical',
      occurrences: 2,
      firstSeenAt: 10,
      lastSeenAt: 20
    })
    expect(repeated.devices['DEVICE-2'].healthState).toBe('critical')

    const acknowledged = acknowledgeDeviceAlert(repeated, repeated.alerts[0].id, 30)
    expect(acknowledged.alerts[0].acknowledgedAt).toBe(30)
    expect(acknowledged.history[0].kind).toBe('alert_acknowledged')

    const resolved = applyDeviceMonitorEvent(acknowledged, {
      type: 'fault_resolved',
      deviceId: 'DEVICE-2',
      transport: 'ble',
      at: 40,
      code: 'OVER_TEMPERATURE'
    })
    expect(resolved.alerts[0].resolvedAt).toBe(40)
    expect(resolved.devices['DEVICE-2'].healthState).toBe('healthy')

    const reopened = applyDeviceMonitorEvent(resolved, {
      type: 'fault',
      deviceId: 'DEVICE-2',
      transport: 'ble',
      at: 50,
      code: 'OVER_TEMPERATURE'
    })
    expect(reopened.alerts).toHaveLength(2)
    expect(reopened.alerts[0]).toMatchObject({
      occurrences: 1,
      acknowledgedAt: null,
      resolvedAt: null
    })
  })

  it('turns NACK and timeout into alerts and clears transport alerts on ACK', () => {
    const nack = applyDeviceMonitorEvent(createEmptyDeviceMonitorSnapshot(), {
      type: 'nack',
      deviceId: 'DEVICE-3',
      transport: 'ble',
      at: 100,
      operation: '图像发送'
    })
    const timeout = applyDeviceMonitorEvent(nack, {
      type: 'timeout',
      deviceId: 'DEVICE-3',
      transport: 'ble',
      at: 200,
      operation: '图像发送'
    })

    expect(timeout.devices['DEVICE-3']).toMatchObject({
      connectionState: 'error',
      lastNackAt: 100,
      lastTimeoutAt: 200
    })
    expect(timeout.alerts.map((alert) => alert.code)).toEqual([
      'TRANSPORT_TIMEOUT',
      'TRANSPORT_NACK'
    ])

    const ack = applyDeviceMonitorEvent(timeout, {
      type: 'ack',
      deviceId: 'DEVICE-3',
      transport: 'ble',
      at: 300,
      operation: '图像发送'
    })
    expect(ack.devices['DEVICE-3']).toMatchObject({
      connectionState: 'online',
      healthState: 'healthy',
      lastAckAt: 300,
      lastSeenAt: 300
    })
    expect(ack.alerts.every((alert) => alert.resolvedAt === 300)).toBe(true)
  })

  it('keeps only the configured number of local history entries', () => {
    let snapshot = createEmptyDeviceMonitorSnapshot()
    for (let at = 1; at <= 3; at += 1) {
      snapshot = applyDeviceMonitorEvent(
        snapshot,
        {
          type: 'heartbeat',
          deviceId: 'DEVICE-4',
          transport: 'wifi',
          at
        },
        2
      )
    }

    expect(snapshot.history.map((entry) => entry.at)).toEqual([3, 2])
  })
})
