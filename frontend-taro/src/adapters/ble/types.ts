import type { WifiScanResult } from '@/types/device'

export interface BleAdapter {
  connectTargetDevice(uuid?: string): Promise<void>
  sendImage(payload: Uint8Array): Promise<void>
  sendHighlight(colors: Array<[number, number, number]>): Promise<void>
  scanWifiNetworks(): Promise<WifiScanResult[]>
}
