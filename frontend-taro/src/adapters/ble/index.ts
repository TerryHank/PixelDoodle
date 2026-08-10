import { resolveAdapterRuntime } from '@/adapters/runtime'
import { getRuntimeEnv } from '@/utils/runtime-env'
import { h5BleAdapter } from './h5'
import { rnBleAdapter } from './rn'
import { weappBleAdapter } from './weapp'

const runtime = resolveAdapterRuntime(getRuntimeEnv())

export const bleAdapter =
  runtime === 'rn'
    ? rnBleAdapter
    : runtime === 'weapp'
      ? weappBleAdapter
      : h5BleAdapter
