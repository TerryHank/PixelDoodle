import Taro from '@tarojs/taro'
import { extractUuidFromScanResult } from './h5'
import type { ScanAdapter } from './types'

export const weappScanAdapter: ScanAdapter = {
  async scanDevice() {
    const result = await Taro.scanCode()
    const uuid = extractUuidFromScanResult(result.result)

    if (!uuid) {
      throw new Error('未从二维码中解析到设备 UUID')
    }

    return uuid
  }
}
