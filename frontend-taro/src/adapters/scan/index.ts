import { resolveAdapterRuntime } from '@/adapters/runtime'
import { getRuntimeEnv } from '@/utils/runtime-env'
import { h5ScanAdapter } from './h5'
import { rnScanAdapter } from './rn'
import { weappScanAdapter } from './weapp'

const runtime = resolveAdapterRuntime(getRuntimeEnv())

export const scanAdapter =
  runtime === 'rn' ? rnScanAdapter : runtime === 'weapp' ? weappScanAdapter : h5ScanAdapter
