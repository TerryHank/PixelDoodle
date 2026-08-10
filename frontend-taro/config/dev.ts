import type { UserConfigExport } from "@tarojs/cli"

export default {
  mini: {},
  h5: {
    devServer: {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      },
      proxy: {
        '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true },
        '/examples': { target: 'http://127.0.0.1:8765', changeOrigin: true }
      }
    }
  }
} satisfies UserConfigExport<'webpack5'>
