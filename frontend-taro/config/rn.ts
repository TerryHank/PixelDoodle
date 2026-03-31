import type { UserConfigExport } from '@tarojs/cli'

const rnConfig = {
  sourceRoot: 'src',
  outputRoot: 'dist-rn',
  rn: {
    appName: 'PixelDoodle'
  }
} satisfies UserConfigExport<'webpack5'>

export default rnConfig
