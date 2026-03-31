import type { BleAdapter } from './types'

export const rnBleAdapter: BleAdapter = {
  async connectTargetDevice() {
    throw new Error('RN Android 端 BLE 适配尚未完成，请先使用手输 UUID 与非 BLE 链路验证')
  },

  async sendImage() {
    throw new Error('RN Android 端 BLE 发送尚未完成')
  },

  async sendHighlight() {
    throw new Error('RN Android 端 BLE 高亮尚未完成')
  },

  async scanWifiNetworks() {
    throw new Error('RN Android 端 WiFi 扫描尚未完成')
  },

  async connectWifiNetwork() {
    throw new Error('RN Android 端 WiFi 配网尚未完成')
  }
}
