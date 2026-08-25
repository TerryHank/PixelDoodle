import type { UserConfigExport } from '@tarojs/cli'

const rnConfig = {
  sourceRoot: 'src',
  outputRoot: 'dist-rn',
  rn: {
    appName: 'DIY拼豆'
  }
} satisfies UserConfigExport<'webpack5'>

export default rnConfig
