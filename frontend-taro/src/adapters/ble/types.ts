import type { WifiScanResult } from '@/types/device'

export interface BleKnownDevice {
  key: string
  name: string
  uuid: string
}

export interface BleAdapter {
  connectTargetDevice(uuid?: string): Promise<string | null>
  addTargetDevice?(): Promise<string | null>
  scanNearbyDevices?(): Promise<BleKnownDevice[]>
  getAuthorizedDevices?(): Promise<BleKnownDevice[]>
  connectKnownDevice?(deviceKey: string): Promise<string | null>
  sendImage(payload: Uint8Array): Promise<void>
  sendHighlight(colors: Array<[number, number, number]>): Promise<void>
  scanWifiNetworks(): Promise<WifiScanResult[]>
  connectWifiNetwork(input: { ssid: string; password?: string }): Promise<string>
}
