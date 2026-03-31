import { resolveAdapterRuntime } from '@/adapters/runtime'
import { h5ScanAdapter } from './h5'
import { rnScanAdapter } from './rn'
import { weappScanAdapter } from './weapp'
const runtime = resolveAdapterRuntime(process.env.TARO_ENV)

export const scanAdapter =
  runtime === 'rn' ? rnScanAdapter : runtime === 'weapp' ? weappScanAdapter : h5ScanAdapter
