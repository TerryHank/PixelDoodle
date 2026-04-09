import { describe, expect, it, vi } from 'vitest'

import { hideLoadingSafely } from '../loading'

describe('loading helpers', () => {
  it('swallows duplicate hideLoading failures', async () => {
    const hideLoading = vi
      .fn()
      .mockRejectedValue(new Error("hideLoading:fail:toast can't be found"))

    await expect(hideLoadingSafely(hideLoading)).resolves.toBeUndefined()
    expect(hideLoading).toHaveBeenCalledTimes(1)
  })
})
