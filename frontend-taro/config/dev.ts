import type { UserConfigExport } from "@tarojs/cli"

export default {
  mini: {},
  h5: {
    devServer: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true },
        '/examples': { target: 'http://127.0.0.1:8765', changeOrigin: true }
      }
    }
  }
} satisfies UserConfigExport<'webpack5'>
