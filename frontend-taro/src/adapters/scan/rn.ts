import type { ScanAdapter } from './types'

export const rnScanAdapter: ScanAdapter = {
  async scanDevice() {
    throw new Error('RN Android 端扫码尚未完成，请先手动输入 UUID')
  }
}
