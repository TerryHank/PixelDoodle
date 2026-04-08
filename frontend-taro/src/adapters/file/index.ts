import { resolveAdapterRuntime } from '@/adapters/runtime'
import { getRuntimeEnv } from '@/utils/runtime-env'
import { h5FileAdapter } from './h5'
import { rnFileAdapter } from './rn'
import { weappFileAdapter } from './weapp'

const runtime = resolveAdapterRuntime(getRuntimeEnv())

export const fileAdapter =
  runtime === 'rn' ? rnFileAdapter : runtime === 'weapp' ? weappFileAdapter : h5FileAdapter
