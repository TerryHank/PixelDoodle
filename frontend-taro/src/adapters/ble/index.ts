import { resolveAdapterRuntime } from '@/adapters/runtime'
import { h5BleAdapter } from './h5'
import { rnBleAdapter } from './rn'
import { weappBleAdapter } from './weapp'
const runtime = resolveAdapterRuntime(process.env.TARO_ENV)

export const bleAdapter =
  runtime === 'rn'
    ? rnBleAdapter
    : runtime === 'weapp'
      ? weappBleAdapter
      : h5BleAdapter
