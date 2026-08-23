export const DEFAULT_DEVICE_OFFLINE_TIMEOUT_MS = 30_000
export const DEVICE_MONITOR_HISTORY_LIMIT = 200

export type DeviceTransport = 'ble' | 'wifi'
export type DeviceConnectionState =
  | 'unknown'
  | 'connecting'
  | 'online'
  | 'offline'
  | 'error'
export type DeviceHealthState = 'unknown' | 'healthy' | 'warning' | 'critical'
export type DeviceFaultSeverity = 'info' | 'warning' | 'critical'

export const DEVICE_FAULT_CATALOG = {
  HEARTBEAT_TIMEOUT: {
    severity: 'warning',
    message: '设备心跳超时'
  },
  TRANSPORT_NACK: {
    severity: 'warning',
    message: '设备拒绝了本次传输'
  },
  TRANSPORT_TIMEOUT: {
    severity: 'warning',
    message: '设备通信超时'
  },
  CHECKSUM_MISMATCH: {
    severity: 'warning',
    message: '设备校验图像数据失败'
  },
  PROTOCOL_ERROR: {
    severity: 'warning',
    message: '设备协议解析失败'
  },
  DEVICE_REBOOT: {
    severity: 'warning',
    message: '设备发生重启'
  },
  OVER_TEMPERATURE: {
    severity: 'critical',
    message: '设备温度过高'
  },
  UNDER_VOLTAGE: {
    severity: 'critical',
    message: '设备供电电压过低'
  },
  OVER_CURRENT: {
    severity: 'critical',
    message: '设备电流过高'
  },
  HARDWARE_FAULT: {
    severity: 'critical',
    message: '设备报告硬件故障'
  },
  UNKNOWN_FAULT: {
    severity: 'warning',
    message: '设备报告未知故障'
  }
} as const satisfies Record<
  string,
  { severity: DeviceFaultSeverity; message: string }
>

export type DeviceFaultCode = keyof typeof DEVICE_FAULT_CATALOG

export interface DeviceTelemetrySnapshot {
  firmwareVersion?: string
  uptimeSeconds?: number
  temperatureC?: number
  supplyVoltageV?: number
  currentA?: number
  brightness?: number
  freeHeapBytes?: number
  resetReason?: string
}

export interface MonitoredDevice {
  deviceId: string
  transport: DeviceTransport
  connectionState: DeviceConnectionState
  healthState: DeviceHealthState
  lastSeenAt: number | null
  lastHeartbeatAt: number | null
  lastAckAt: number | null
  lastNackAt: number | null
  lastTimeoutAt: number | null
  telemetry: DeviceTelemetrySnapshot | null
}

export interface DeviceAlert {
  id: string
  deviceId: string
  transport: DeviceTransport
  code: DeviceFaultCode
  severity: DeviceFaultSeverity
  message: string
  firstSeenAt: number
  lastSeenAt: number
  occurrences: number
  acknowledgedAt: number | null
  resolvedAt: number | null
}

export type DeviceMonitorHistoryKind =
  | 'connection'
  | 'heartbeat'
  | 'heartbeat_timeout'
  | 'ack'
  | 'nack'
  | 'timeout'
  | 'fault'
  | 'fault_resolved'
  | 'alert_acknowledged'

export interface DeviceMonitorHistoryEntry {
  id: string
  deviceId: string
  transport: DeviceTransport
  kind: DeviceMonitorHistoryKind
  at: number
  message: string
  operation?: string
  faultCode?: DeviceFaultCode
  severity?: DeviceFaultSeverity
}

export interface DeviceMonitorSnapshot {
  devices: Record<string, MonitoredDevice>
  alerts: DeviceAlert[]
  history: DeviceMonitorHistoryEntry[]
  sequence: number
}

interface BaseDeviceEvent {
  deviceId: string
  transport: DeviceTransport
  at: number
}

export type DeviceMonitorEvent =
  | (BaseDeviceEvent & {
      type: 'connection'
      state: Exclude<DeviceConnectionState, 'unknown'>
      message?: string
    })
  | (BaseDeviceEvent & {
      type: 'heartbeat'
      telemetry?: DeviceTelemetrySnapshot
    })
  | (BaseDeviceEvent & {
      type: 'heartbeat_timeout'
      timeoutMs: number
    })
  | (BaseDeviceEvent & {
      type: 'ack'
      operation: string
    })
  | (BaseDeviceEvent & {
      type: 'nack'
      operation: string
      message?: string
    })
  | (BaseDeviceEvent & {
      type: 'timeout'
      operation: string
      message?: string
    })
  | (BaseDeviceEvent & {
      type: 'fault'
      code: DeviceFaultCode
      message?: string
      severity?: DeviceFaultSeverity
    })
  | (BaseDeviceEvent & {
      type: 'fault_resolved'
      code: DeviceFaultCode
      message?: string
    })

export function createEmptyDeviceMonitorSnapshot(): DeviceMonitorSnapshot {
  return {
    devices: {},
    alerts: [],
    history: [],
    sequence: 0
  }
}

function normalizeDeviceId(deviceId: string) {
  const normalized = deviceId.trim().toUpperCase()
  if (!normalized) {
    throw new Error('deviceId is required')
  }
  return normalized
}

function createMonitoredDevice(
  deviceId: string,
  transport: DeviceTransport
): MonitoredDevice {
  return {
    deviceId,
    transport,
    connectionState: 'unknown',
    healthState: 'unknown',
    lastSeenAt: null,
    lastHeartbeatAt: null,
    lastAckAt: null,
    lastNackAt: null,
    lastTimeoutAt: null,
    telemetry: null
  }
}

function deriveHealthState(
  device: MonitoredDevice,
  alerts: DeviceAlert[]
): DeviceHealthState {
  const activeAlerts = alerts.filter(
    (alert) => alert.deviceId === device.deviceId && alert.resolvedAt == null
  )
  if (activeAlerts.some((alert) => alert.severity === 'critical')) {
    return 'critical'
  }
  if (activeAlerts.some((alert) => alert.severity === 'warning')) {
    return 'warning'
  }
  return device.connectionState === 'online' ? 'healthy' : 'unknown'
}

function connectionMessage(state: Exclude<DeviceConnectionState, 'unknown'>) {
  switch (state) {
    case 'connecting':
      return '正在连接设备'
    case 'online':
      return '设备已连接'
    case 'offline':
      return '设备已断开'
    case 'error':
      return '设备连接异常'
  }
}

export function applyDeviceMonitorEvent(
  snapshot: DeviceMonitorSnapshot,
  event: DeviceMonitorEvent,
  historyLimit = DEVICE_MONITOR_HISTORY_LIMIT
): DeviceMonitorSnapshot {
  const deviceId = normalizeDeviceId(event.deviceId)
  let sequence = snapshot.sequence
  const nextId = (prefix: string) => `${prefix}-${deviceId}-${event.at}-${++sequence}`
  let alerts = snapshot.alerts.map((alert) => ({ ...alert }))
  const existingDevice = snapshot.devices[deviceId]
  const device: MonitoredDevice = {
    ...(existingDevice ?? createMonitoredDevice(deviceId, event.transport)),
    deviceId,
    transport: event.transport,
    telemetry: existingDevice?.telemetry ? { ...existingDevice.telemetry } : null
  }
  let historyMessage = ''
  let historyOperation: string | undefined
  let historyFaultCode: DeviceFaultCode | undefined
  let historySeverity: DeviceFaultSeverity | undefined

  const resolveAlert = (code: DeviceFaultCode) => {
    alerts = alerts.map((alert) =>
      alert.deviceId === deviceId && alert.code === code && alert.resolvedAt == null
        ? { ...alert, resolvedAt: event.at }
        : alert
    )
  }

  const raiseAlert = (
    code: DeviceFaultCode,
    message?: string,
    severity?: DeviceFaultSeverity
  ) => {
    const definition = DEVICE_FAULT_CATALOG[code]
    const resolvedSeverity = severity ?? definition.severity
    const resolvedMessage = message?.trim() || definition.message
    const existingIndex = alerts.findIndex(
      (alert) =>
        alert.deviceId === deviceId && alert.code === code && alert.resolvedAt == null
    )

    if (existingIndex >= 0) {
      alerts[existingIndex] = {
        ...alerts[existingIndex],
        transport: event.transport,
        severity: resolvedSeverity,
        message: resolvedMessage,
        lastSeenAt: event.at,
        occurrences: alerts[existingIndex].occurrences + 1
      }
    } else {
      alerts.unshift({
        id: nextId('alert'),
        deviceId,
        transport: event.transport,
        code,
        severity: resolvedSeverity,
        message: resolvedMessage,
        firstSeenAt: event.at,
        lastSeenAt: event.at,
        occurrences: 1,
        acknowledgedAt: null,
        resolvedAt: null
      })
    }
    historyFaultCode = code
    historySeverity = resolvedSeverity
  }

  switch (event.type) {
    case 'connection':
      device.connectionState = event.state
      if (event.state === 'online') {
        device.lastSeenAt = event.at
        resolveAlert('HEARTBEAT_TIMEOUT')
      }
      historyMessage = event.message?.trim() || connectionMessage(event.state)
      break
    case 'heartbeat':
      device.connectionState = 'online'
      device.lastSeenAt = event.at
      device.lastHeartbeatAt = event.at
      if (event.telemetry) {
        device.telemetry = { ...event.telemetry }
      }
      resolveAlert('HEARTBEAT_TIMEOUT')
      historyMessage = '收到设备心跳'
      break
    case 'heartbeat_timeout':
      device.connectionState = 'offline'
      device.lastTimeoutAt = event.at
      raiseAlert(
        'HEARTBEAT_TIMEOUT',
        `设备超过 ${event.timeoutMs}ms 未上报状态`
      )
      historyMessage = '设备心跳超时，已标记离线'
      break
    case 'ack':
      device.connectionState = 'online'
      device.lastSeenAt = event.at
      device.lastAckAt = event.at
      resolveAlert('HEARTBEAT_TIMEOUT')
      resolveAlert('TRANSPORT_NACK')
      resolveAlert('TRANSPORT_TIMEOUT')
      historyMessage = `${event.operation} 已被设备确认`
      historyOperation = event.operation
      break
    case 'nack':
      device.connectionState = 'online'
      device.lastSeenAt = event.at
      device.lastNackAt = event.at
      raiseAlert('TRANSPORT_NACK', event.message)
      historyMessage = event.message?.trim() || `${event.operation} 被设备拒绝`
      historyOperation = event.operation
      break
    case 'timeout':
      device.connectionState = 'error'
      device.lastTimeoutAt = event.at
      raiseAlert('TRANSPORT_TIMEOUT', event.message)
      historyMessage = event.message?.trim() || `${event.operation} 通信超时`
      historyOperation = event.operation
      break
    case 'fault':
      if (device.connectionState === 'unknown') {
        device.connectionState = 'online'
      }
      device.lastSeenAt = event.at
      raiseAlert(event.code, event.message, event.severity)
      historyMessage = event.message?.trim() || DEVICE_FAULT_CATALOG[event.code].message
      break
    case 'fault_resolved':
      resolveAlert(event.code)
      historyFaultCode = event.code
      historyMessage =
        event.message?.trim() || `${DEVICE_FAULT_CATALOG[event.code].message}已恢复`
      break
  }

  device.healthState = deriveHealthState(device, alerts)
  const historyEntry: DeviceMonitorHistoryEntry = {
    id: nextId('event'),
    deviceId,
    transport: event.transport,
    kind: event.type,
    at: event.at,
    message: historyMessage,
    ...(historyOperation ? { operation: historyOperation } : {}),
    ...(historyFaultCode ? { faultCode: historyFaultCode } : {}),
    ...(historySeverity ? { severity: historySeverity } : {})
  }

  return {
    devices: {
      ...snapshot.devices,
      [deviceId]: device
    },
    alerts,
    history: [historyEntry, ...snapshot.history].slice(0, historyLimit),
    sequence
  }
}

export function evaluateDeviceOffline(
  snapshot: DeviceMonitorSnapshot,
  now: number,
  timeoutMs = DEFAULT_DEVICE_OFFLINE_TIMEOUT_MS
): DeviceMonitorSnapshot {
  let next = snapshot
  Object.values(snapshot.devices).forEach((device) => {
    if (
      device.lastSeenAt != null &&
      device.connectionState !== 'offline' &&
      now - device.lastSeenAt >= timeoutMs
    ) {
      next = applyDeviceMonitorEvent(next, {
        type: 'heartbeat_timeout',
        deviceId: device.deviceId,
        transport: device.transport,
        at: now,
        timeoutMs
      })
    }
  })
  return next
}

export function acknowledgeDeviceAlert(
  snapshot: DeviceMonitorSnapshot,
  alertId: string,
  at: number
): DeviceMonitorSnapshot {
  const target = snapshot.alerts.find((alert) => alert.id === alertId)
  if (!target || target.acknowledgedAt != null) {
    return snapshot
  }

  const sequence = snapshot.sequence + 1
  const alerts = snapshot.alerts.map((alert) =>
    alert.id === alertId ? { ...alert, acknowledgedAt: at } : alert
  )
  const device = snapshot.devices[target.deviceId]
  const historyEntry: DeviceMonitorHistoryEntry = {
    id: `event-${target.deviceId}-${at}-${sequence}`,
    deviceId: target.deviceId,
    transport: target.transport,
    kind: 'alert_acknowledged',
    at,
    message: `已确认告警：${target.message}`,
    faultCode: target.code,
    severity: target.severity
  }

  return {
    ...snapshot,
    alerts,
    history: [historyEntry, ...snapshot.history].slice(
      0,
      DEVICE_MONITOR_HISTORY_LIMIT
    ),
    sequence,
    devices: device
      ? {
          ...snapshot.devices,
          [target.deviceId]: {
            ...device,
            healthState: deriveHealthState(device, alerts)
          }
        }
      : snapshot.devices
  }
}
