import path from 'node:path'
import pkg from '../package.json'

import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin'
import devConfig from './dev'
import rnConfig from './rn'
import prodConfig from './prod'

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge) => {
  const assetVersion = `v${pkg.version}`
  const outputRoot = process.env.TARO_OUTPUT_ROOT || 'dist'
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'frontend-taro',
    date: '2026-3-31',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot,
    copy: {
      patterns: [
        {
          from: 'static',
          to: `${outputRoot}/static`
        }
      ],
      options: {}
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: {
      enable: true
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src')
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {

          }
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
      }
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: `js/[name].${assetVersion}.[hash:8].js`,
        chunkFilename: `js/[name].${assetVersion}.[chunkhash:8].js`
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: `css/[name].${assetVersion}.[hash].css`,
        chunkFilename: `css/[name].${assetVersion}.[chunkhash].css`
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {}
        },
        // H5 首页还原样式通过文件头注释单独关闭 pxtransform。
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
      }
    }
  }

  const rnMergeConfig = process.env.TARO_ENV === 'rn' ? rnConfig : {}

  if (process.env.NODE_ENV === 'development') {
    // 本地开发构建配置（不混淆压缩）
    return merge({}, baseConfig, devConfig, rnMergeConfig)
  }
  // 生产构建配置（默认开启压缩混淆等）
  return merge({}, baseConfig, prodConfig, rnMergeConfig)
})
