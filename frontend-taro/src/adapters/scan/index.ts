import { h5ScanAdapter } from './h5'
import { weappScanAdapter } from './weapp'

export const scanAdapter =
  process.env.TARO_ENV === 'weapp' ? weappScanAdapter : h5ScanAdapter
