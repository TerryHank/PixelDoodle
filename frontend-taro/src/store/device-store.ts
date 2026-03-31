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
  wifiScanResults: WifiScanResult[]
  selectedWifiHotspot: WifiScanResult | null
  registeredDeviceIp: string
  registeredWifiDevice: RegisteredWifiDevice | null
  isSending: boolean
}

export const useDeviceStore = create<DeviceState>(() => ({
  targetDeviceUuid: '',
  connectionMode: DEFAULT_CONNECTION_MODE,
  bleConnectionStatus: 'idle',
  bleCharacteristicStatus: 'idle',
  wifiScanResults: [],
  selectedWifiHotspot: null,
  registeredDeviceIp: '',
  registeredWifiDevice: null,
  isSending: false
}))

