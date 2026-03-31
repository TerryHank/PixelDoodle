import type { ColorSummaryItem, GridSize, PixelMatrix } from '../types/api'
import type { ConnectionMode, ScanMode, WifiScanResult } from '../types/device'

export const DEFAULT_PALETTE_PRESET = '221'
export const DEFAULT_CONNECTION_MODE: ConnectionMode = 'ble'
export const DEFAULT_SCAN_MODE: ScanMode = 'qr'

export const EXAMPLE_GRID_SIZE: GridSize = {
  width: 3,
  height: 2
}

export const EXAMPLE_PIXEL_MATRIX: PixelMatrix = [
  ['A1', 'A1', 'B1'],
  ['A1', null, 'B1']
]

export const EXAMPLE_COLOR_SUMMARY: ColorSummaryItem[] = [
  {
    code: 'A1',
    name: 'White',
    name_zh: '白色',
    hex: '#FFFFFF',
    rgb: [255, 255, 255],
    count: 3
  },
  {
    code: 'B1',
    name: 'Black',
    name_zh: '黑色',
    hex: '#000000',
    rgb: [0, 0, 0],
    count: 2
  }
]

export const EXAMPLE_WIFI_SCAN_RESULTS: WifiScanResult[] = [
  {
    ssid: 'PixelDoodle-ESP32',
    bssid: 'AA:BB:CC:DD:EE:FF',
    rssi: -42,
    secure: true,
    channel: 6,
    ip: '192.168.4.1'
  }
]

export const EXAMPLE_TARGET_DEVICE_UUID = 'F42DC97179B4'

