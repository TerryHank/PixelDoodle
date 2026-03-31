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
  setBleConnectionStatus: (status: DeviceConnectionStatus) => void
  setBleCharacteristicStatus: (status: DeviceCharacteristicStatus) => void
  setWifiScanResults: (results: WifiScanResult[]) => void
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
  setBleConnectionStatus: (status) =>
    set(() => ({
      bleConnectionStatus: status
    })),
  setBleCharacteristicStatus: (status) =>
    set(() => ({
      bleCharacteristicStatus: status
    })),
  setWifiScanResults: (results) =>
    set(() => ({
      wifiScanResults: results
    })),
  toggleHighlightCode: (code) => {
    const current = get().activeHighlightCodes
    const next = current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]

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
