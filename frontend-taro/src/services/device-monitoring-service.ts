import {
  DEFAULT_DEVICE_OFFLINE_TIMEOUT_MS,
  type DeviceConnectionState,
  type DeviceFaultCode,
  type DeviceFaultSeverity,
  type DeviceMonitorEvent,
  type DeviceTelemetrySnapshot,
  type DeviceTransport
} from '@/domain/device-monitoring'
import { useDeviceMonitorStore } from '@/store/device-monitor-store'

interface TimedDeviceInput {
  deviceId: string
  transport: DeviceTransport
  at?: number
}

export interface DeviceHeartbeatInput extends TimedDeviceInput {
  telemetry?: DeviceTelemetrySnapshot
}

export interface DeviceConnectionInput extends TimedDeviceInput {
  state: Exclude<DeviceConnectionState, 'unknown'>
  message?: string
}

export interface DeviceFaultInput extends TimedDeviceInput {
  code: DeviceFaultCode
  message?: string
  severity?: DeviceFaultSeverity
}

export interface DeviceTransportResultInput extends TimedDeviceInput {
  operation?: string
  message?: string
}

function eventTime(at?: number) {
  return at ?? Date.now()
}

export function recordDeviceMonitorEvent(event: DeviceMonitorEvent) {
  useDeviceMonitorStore.getState().recordEvent(event)
}

export function reportDeviceConnection(input: DeviceConnectionInput) {
  recordDeviceMonitorEvent({
    type: 'connection',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    state: input.state,
    ...(input.message ? { message: input.message } : {})
  })
}

export function reportDeviceHeartbeat(input: DeviceHeartbeatInput) {
  recordDeviceMonitorEvent({
    type: 'heartbeat',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    ...(input.telemetry ? { telemetry: input.telemetry } : {})
  })
}

export function reportDeviceFault(input: DeviceFaultInput) {
  recordDeviceMonitorEvent({
    type: 'fault',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    code: input.code,
    ...(input.message ? { message: input.message } : {}),
    ...(input.severity ? { severity: input.severity } : {})
  })
}

export function resolveDeviceFault(input: Omit<DeviceFaultInput, 'severity'>) {
  recordDeviceMonitorEvent({
    type: 'fault_resolved',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    code: input.code,
    ...(input.message ? { message: input.message } : {})
  })
}

export function reportTransportAck(input: DeviceTransportResultInput) {
  recordDeviceMonitorEvent({
    type: 'ack',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    operation: input.operation || '数据传输'
  })
}

export function reportTransportNack(input: DeviceTransportResultInput) {
  recordDeviceMonitorEvent({
    type: 'nack',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    operation: input.operation || '数据传输',
    ...(input.message ? { message: input.message } : {})
  })
}

export function reportTransportTimeout(input: DeviceTransportResultInput) {
  recordDeviceMonitorEvent({
    type: 'timeout',
    deviceId: input.deviceId,
    transport: input.transport,
    at: eventTime(input.at),
    operation: input.operation || '数据传输',
    ...(input.message ? { message: input.message } : {})
  })
}

export function reportBleAck(input: Omit<DeviceTransportResultInput, 'transport'>) {
  reportTransportAck({ ...input, transport: 'ble' })
}

export function reportBleNack(input: Omit<DeviceTransportResultInput, 'transport'>) {
  reportTransportNack({ ...input, transport: 'ble' })
}

export function reportBleTimeout(input: Omit<DeviceTransportResultInput, 'transport'>) {
  reportTransportTimeout({ ...input, transport: 'ble' })
}

export function reportWifiAck(input: Omit<DeviceTransportResultInput, 'transport'>) {
  reportTransportAck({ ...input, transport: 'wifi' })
}

export function reportWifiNack(input: Omit<DeviceTransportResultInput, 'transport'>) {
  reportTransportNack({ ...input, transport: 'wifi' })
}

export function reportWifiTimeout(input: Omit<DeviceTransportResultInput, 'transport'>) {
  reportTransportTimeout({ ...input, transport: 'wifi' })
}

export function acknowledgeDeviceAlert(alertId: string, at = Date.now()) {
  useDeviceMonitorStore.getState().acknowledgeAlert(alertId, at)
}

export function evaluateMonitoredDevices(
  now = Date.now(),
  timeoutMs = DEFAULT_DEVICE_OFFLINE_TIMEOUT_MS
) {
  useDeviceMonitorStore.getState().evaluateOffline(now, timeoutMs)
}

export interface OfflineMonitorOptions {
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  evaluateImmediately?: boolean
}

export function startDeviceOfflineMonitor(options: OfflineMonitorOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEVICE_OFFLINE_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? Math.max(1_000, Math.floor(timeoutMs / 3))
  const now = options.now ?? Date.now
  const evaluate = () => evaluateMonitoredDevices(now(), timeoutMs)

  if (options.evaluateImmediately !== false) {
    evaluate()
  }
  const timer = setInterval(evaluate, intervalMs)
  return () => clearInterval(timer)
}
