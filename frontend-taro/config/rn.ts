import type { UserConfigExport } from '@tarojs/cli'

const rnConfig: UserConfigExport<'webpack5'> = {
  sourceRoot: 'src',
  outputRoot: 'dist-rn',
  rn: {
    appName: 'PixelDoodle'
  }
}

export default rnConfig
