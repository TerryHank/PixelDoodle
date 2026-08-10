import { create } from 'zustand'
import { DEFAULT_CONNECTION_MODE } from '../constants/examples'
import type {
  ConnectionMode,
  DeviceCharacteristicStatus,
  DeviceConnectionStatus,
  RegisteredWifiDevice,
  WifiScanResult
} from '../types/device'

export interface DeviceState {
  targetDeviceUuid: string
  connectionMode: ConnectionMode
  bleConnectionStatus: DeviceConnectionStatus
  bleCharacteristicStatus: DeviceCharacteristicStatus
  activeHighlightCodes: string[]
  wifiScanResults: WifiScanResult[]
  selectedWifiHotspot: WifiScanResult | null
  registeredWifiDevice: RegisteredWifiDevice | null
  isSending: boolean
  setTargetDeviceUuid: (uuid: string) => void
  setConnectionMode: (mode: ConnectionMode) => void
  setBleConnectionStatus: (status: DeviceConnectionStatus) => void
  setBleCharacteristicStatus: (status: DeviceCharacteristicStatus) => void
  setWifiScanResults: (results: WifiScanResult[]) => void
  setSelectedWifiHotspot: (hotspot: WifiScanResult | null) => void
  setRegisteredWifiDevice: (device: RegisteredWifiDevice | null) => void
  setIsSending: (value: boolean) => void
  toggleHighlightCode: (code: string) => string[]
  clearHighlightCodes: () => void
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  targetDeviceUuid: '',
  connectionMode: DEFAULT_CONNECTION_MODE,
  bleConnectionStatus: 'idle',
  bleCharacteristicStatus: 'idle',
  activeHighlightCodes: [],
  wifiScanResults: [],
  selectedWifiHotspot: null,
  registeredWifiDevice: null,
  isSending: false,
  setTargetDeviceUuid: (uuid) =>
    set((state) => ({
      targetDeviceUuid: uuid,
      registeredWifiDevice:
        state.registeredWifiDevice?.device_uuid === uuid
          ? state.registeredWifiDevice
          : null
    })),
  setConnectionMode: (mode) =>
    set(() => ({
      connectionMode: mode
    })),
  setBleConnectionStatus: (status) =>
    set(() => ({
      bleConnectionStatus: status
    })),
  setBleCharacteristicStatus: (status) =>
    set(() => ({
      bleCharacteristicStatus: status
    })),
  setWifiScanResults: (results) =>
    set((state) => ({
      wifiScanResults: results,
      selectedWifiHotspot:
        results.find((item) => item.ssid === state.selectedWifiHotspot?.ssid) ||
        null
    })),
  setSelectedWifiHotspot: (hotspot) =>
    set(() => ({
      selectedWifiHotspot: hotspot
    })),
  setRegisteredWifiDevice: (device) =>
    set(() => ({
      registeredWifiDevice: device
    })),
  setIsSending: (value) =>
    set(() => ({
      isSending: value
    })),
  toggleHighlightCode: (code) => {
    const current = get().activeHighlightCodes
    const next =
      current.length === 1 && current[0] === code
        ? []
        : [code]

    set(() => ({
      activeHighlightCodes: next
    }))

    return next
  },
  clearHighlightCodes: () =>
    set(() => ({
      activeHighlightCodes: []
    }))
}))
