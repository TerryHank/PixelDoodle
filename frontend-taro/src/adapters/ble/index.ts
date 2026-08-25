import { isTauri } from '@tauri-apps/api/core'
import { resolveAdapterRuntime } from '@/adapters/runtime'
import { getRuntimeEnv } from '@/utils/runtime-env'
import { h5BleAdapter } from './h5'
import { rnBleAdapter } from './rn'
import { tauriBleAdapter } from './tauri'
import { weappBleAdapter } from './weapp'

const runtime = resolveAdapterRuntime(getRuntimeEnv())

export const bleAdapter =
  runtime === 'rn'
    ? rnBleAdapter
    : runtime === 'weapp'
      ? weappBleAdapter
      : isTauri()
        ? tauriBleAdapter
        : h5BleAdapter
