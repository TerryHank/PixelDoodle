import { describe, expect, it, vi } from 'vitest'

import { applyPatternChangeAndMaybeRegenerate } from './pattern-regeneration'

describe('pattern regeneration', () => {
  it('regenerates from the original image after a pattern option changes', async () => {
    const applyChange = vi.fn()
    const regenerate = vi.fn().mockResolvedValue(undefined)

    const didRegenerate = await applyPatternChangeAndMaybeRegenerate({
      applyChange,
      originalImage: '/tmp/original.png',
      regenerate
    })

    expect(applyChange).toHaveBeenCalledTimes(1)
    expect(regenerate).toHaveBeenCalledWith('/tmp/original.png')
    expect(didRegenerate).toBe(true)
  })

  it('skips regeneration when there is no original image yet', async () => {
    const applyChange = vi.fn()
    const regenerate = vi.fn().mockResolvedValue(undefined)

    const didRegenerate = await applyPatternChangeAndMaybeRegenerate({
      applyChange,
      originalImage: '',
      regenerate
    })

    expect(applyChange).toHaveBeenCalledTimes(1)
    expect(regenerate).not.toHaveBeenCalled()
    expect(didRegenerate).toBe(false)
  })
})
