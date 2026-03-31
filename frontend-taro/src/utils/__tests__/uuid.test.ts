import { describe, expect, it } from 'vitest'
import { normalizeUuid, isUuidLike } from '../uuid'

describe('uuid utils', () => {
  it('normalizes lowercase uuid', () => {
    expect(normalizeUuid('f42dc97179b4')).toBe('F42DC97179B4')
  })

  it('rejects invalid uuid', () => {
    expect(isUuidLike('123')).toBe(false)
  })
})
