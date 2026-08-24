import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isTauriMock, saveMock, writeFileMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  saveMock: vi.fn(),
  writeFileMock: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: isTauriMock }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: saveMock }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: writeFileMock }))

import { h5FileAdapter } from './h5'

describe('h5 file adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauriMock.mockReturnValue(false)
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

  it('uses the native save picker and writes the selected Android content URI', async () => {
    isTauriMock.mockReturnValue(true)
    saveMock.mockResolvedValue('content://downloads/pattern.png')
    const data = new Uint8Array([137, 80, 78, 71]).buffer

    await h5FileAdapter.saveBinaryFile('pattern.png', 'image/png', data)

    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: 'pattern.png',
      filters: [{ name: 'image/png', extensions: ['png'] }]
    })
    expect(writeFileMock).toHaveBeenCalledWith(
      'content://downloads/pattern.png',
      new Uint8Array(data)
    )
  })
})
