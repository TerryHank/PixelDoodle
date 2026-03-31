import { describe, expect, it } from 'vitest'
import packageJson from '../../../package.json'
import rnConfig from '../../../config/rn'
import { isRnEnv } from '../rn-env'

describe('rn env utils', () => {
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
    expect(packageJson.scripts?.android).toBe('react-native run-android')
    expect(packageJson.scripts?.['apk:debug']).toBe('cd android && gradlew assembleDebug')
    expect(packageJson.scripts?.['apk:release']).toBe('cd android && gradlew assembleRelease')
  })
})
