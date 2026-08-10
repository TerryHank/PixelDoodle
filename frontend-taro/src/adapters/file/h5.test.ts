import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { h5FileAdapter } from './h5'

describe('h5 file adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the object URL alive until the browser has started the download', async () => {
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn()
    }
    const appendChild = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild }
    })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    await h5FileAdapter.saveBinaryFile(
      'pattern.png',
      'image/png',
      new Uint8Array([1, 2, 3]).buffer
    )

    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    expect(anchor.remove).toHaveBeenCalledOnce()
  })
})
