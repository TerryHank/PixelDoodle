import { describe, expect, it } from 'vitest'

import { resolveAdapterRuntime } from '../runtime'

describe('adapter runtime selection', () => {
  it('returns rn when env is rn', () => {
    expect(resolveAdapterRuntime('rn')).toBe('rn')
  })

  it('returns weapp when env is weapp', () => {
    expect(resolveAdapterRuntime('weapp')).toBe('weapp')
  })

  it('falls back to h5 for other environments', () => {
    expect(resolveAdapterRuntime('h5')).toBe('h5')
    expect(resolveAdapterRuntime(undefined)).toBe('h5')
  })
})
