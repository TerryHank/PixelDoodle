export type ConnectionMode = 'ble' | 'wifi'
export type ScanMode = 'qr' | 'manual'

export type DeviceConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
export type DeviceCharacteristicStatus = 'idle' | 'discovering' | 'ready' | 'missing' | 'error'

export interface WifiScanResult {
  ssid: string
  bssid?: string
  rssi?: number
  secure?: boolean
  channel?: number
  ip?: string
}

export interface RegisteredWifiDevice {
  device_uuid: string
  ip: string
  updated_at: number
}

export interface TargetDevice {
  device_uuid: string
  address?: string
  name?: string
}

