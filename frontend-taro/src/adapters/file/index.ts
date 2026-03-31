import { h5FileAdapter } from './h5'
import { weappFileAdapter } from './weapp'

export const fileAdapter =
  process.env.TARO_ENV === 'weapp' ? weappFileAdapter : h5FileAdapter
