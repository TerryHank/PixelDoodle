import type { WifiScanResult } from '@/types/device'

export interface BleKnownDevice {
  key: string
  name: string
  uuid: string
}

export interface BleDeviceStatus {
  brightness: number
}

export interface BleAdapter {
  connectTargetDevice(uuid?: string): Promise<string | null>
  addTargetDevice?(): Promise<string | null>
  scanNearbyDevices?(): Promise<BleKnownDevice[]>
  getAuthorizedDevices?(): Promise<BleKnownDevice[]>
  connectKnownDevice?(deviceKey: string): Promise<string | null>
  readStatus?(): Promise<BleDeviceStatus>
  activateDevice(accessToken: string): Promise<void>
  sendImage(payload: Uint8Array): Promise<void>
  sendHighlight(colors: Array<[number, number, number]>): Promise<void>
  scanWifiNetworks(): Promise<WifiScanResult[]>
  connectWifiNetwork(input: { ssid: string; password?: string }): Promise<string>
}
