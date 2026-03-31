import { resolveAdapterRuntime } from '@/adapters/runtime'
import { h5FileAdapter } from './h5'
import { rnFileAdapter } from './rn'
import { weappFileAdapter } from './weapp'
const runtime = resolveAdapterRuntime(process.env.TARO_ENV)

export const fileAdapter =
  runtime === 'rn' ? rnFileAdapter : runtime === 'weapp' ? weappFileAdapter : h5FileAdapter
