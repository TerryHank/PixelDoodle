import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/taro', () => ({
  default: {
    ENV_TYPE: {
      WEB: 'WEB',
      WEAPP: 'WEAPP',
      RN: 'RN'
    },
    getEnv: () => 'WEB'
  }
}))

import packageJson from '../../../package.json'
import rnConfig from '../../../config/rn'
import { getApiBaseUrlByEnv } from '../../services/env'
import { isRnEnv } from '../rn-env'

describe('rn env utils', () => {
  it('returns explicit rn base url', () => {
    expect(getApiBaseUrlByEnv('rn', 'http://10.0.2.2:8765')).toBe('http://10.0.2.2:8765')
  })

  it('detects rn environment', () => {
    expect(isRnEnv('rn')).toBe(true)
  })

  it('rejects h5 environment', () => {
    expect(isRnEnv('h5')).toBe(false)
  })

  it('keeps rn config smoke values', () => {
    const typedRnConfig = rnConfig as {
      outputRoot?: string
      rn?: {
        appName?: string
      }
    }

    expect(typedRnConfig.outputRoot).toBe('dist-rn')
    expect(typedRnConfig.rn?.appName).toBe('PixelDoodle')
  })

  it('exposes rn build scripts', () => {
    expect(packageJson.scripts?.['dev:rn']).toBe('taro build --type rn --watch')
    expect(packageJson.scripts?.['build:rn']).toBe('taro build --type rn')
  })
})
