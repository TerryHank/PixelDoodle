import { h5BleAdapter } from './h5'
import type { BleAdapter } from './types'

const unsupportedBleAdapter: BleAdapter = {
  async connectTargetDevice() {
    throw new Error('当前端 BLE 适配器将在下一步接入')
  },
  async sendImage() {
    throw new Error('当前端 BLE 适配器将在下一步接入')
  },
  async sendHighlight() {
    throw new Error('当前端 BLE 适配器将在下一步接入')
  },
  async scanWifiNetworks() {
    throw new Error('当前端 BLE 适配器将在下一步接入')
  }
}

export const bleAdapter =
  process.env.TARO_ENV === 'h5' ? h5BleAdapter : unsupportedBleAdapter
