import { describe, expect, it } from 'vitest'
import { isRnEnv } from '../rn-env'

describe('rn env utils', () => {
  it('detects rn environment', () => {
    expect(isRnEnv('rn')).toBe(true)
  })

  it('rejects h5 environment', () => {
    expect(isRnEnv('h5')).toBe(false)
  })
})
