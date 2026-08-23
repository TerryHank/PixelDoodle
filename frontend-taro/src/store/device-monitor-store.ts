import { create } from 'zustand'

import {
  acknowledgeDeviceAlert,
  applyDeviceMonitorEvent,
  createEmptyDeviceMonitorSnapshot,
  evaluateDeviceOffline,
  type DeviceMonitorEvent,
  type DeviceMonitorSnapshot
} from '@/domain/device-monitoring'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

export const DEVICE_MONITOR_STORAGE_KEY = 'pixeldoodle:device-monitor:v1'

interface PersistedDeviceMonitorState {
  version: 1
  snapshot: DeviceMonitorSnapshot
}

export interface DeviceMonitorStoreState extends DeviceMonitorSnapshot {
  recordEvent: (event: DeviceMonitorEvent) => void
  evaluateOffline: (now?: number, timeoutMs?: number) => void
  acknowledgeAlert: (alertId: string, at?: number) => void
  clearHistory: () => void
  resetMonitor: () => void
}

function isSnapshot(value: unknown): value is DeviceMonitorSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<DeviceMonitorSnapshot>
  return (
    !!candidate.devices &&
    typeof candidate.devices === 'object' &&
    Array.isArray(candidate.alerts) &&
    Array.isArray(candidate.history) &&
    Number.isInteger(candidate.sequence)
  )
}

function readInitialSnapshot() {
  const persisted = readPersistedState<PersistedDeviceMonitorState | null>(
    DEVICE_MONITOR_STORAGE_KEY,
    null
  )
  return persisted?.version === 1 && isSnapshot(persisted.snapshot)
    ? persisted.snapshot
    : createEmptyDeviceMonitorSnapshot()
}

function persist(snapshot: DeviceMonitorSnapshot) {
  writePersistedState<PersistedDeviceMonitorState>(DEVICE_MONITOR_STORAGE_KEY, {
    version: 1,
    snapshot
  })
}

function selectSnapshot(state: DeviceMonitorStoreState): DeviceMonitorSnapshot {
  return {
    devices: state.devices,
    alerts: state.alerts,
    history: state.history,
    sequence: state.sequence
  }
}

export const useDeviceMonitorStore = create<DeviceMonitorStoreState>((set) => ({
  ...readInitialSnapshot(),
  recordEvent: (event) =>
    set((state) => {
      const next = applyDeviceMonitorEvent(selectSnapshot(state), event)
      persist(next)
      return next
    }),
  evaluateOffline: (now = Date.now(), timeoutMs) =>
    set((state) => {
      const current = selectSnapshot(state)
      const next = evaluateDeviceOffline(current, now, timeoutMs)
      if (next !== current) {
        persist(next)
      }
      return next
    }),
  acknowledgeAlert: (alertId, at = Date.now()) =>
    set((state) => {
      const current = selectSnapshot(state)
      const next = acknowledgeDeviceAlert(current, alertId, at)
      if (next !== current) {
        persist(next)
      }
      return next
    }),
  clearHistory: () =>
    set((state) => {
      const next = {
        ...selectSnapshot(state),
        history: []
      }
      persist(next)
      return next
    }),
  resetMonitor: () =>
    set(() => {
      const next = createEmptyDeviceMonitorSnapshot()
      persist(next)
      return next
    })
}))
