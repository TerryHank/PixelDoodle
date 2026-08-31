import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { PixelEditorH5 } from './index.h5'

describe('pixel editor device send action', () => {
  it('shows a manual send action for a connected device', () => {
    const html = renderToStaticMarkup(
      <PixelEditorH5
        matrix={[[null]]}
        colors={[]}
        presets={{}}
        palettePreset='full'
        boardLabel='104 × 104'
        onChange={vi.fn()}
        onPalettePresetChange={vi.fn()}
        onSave={vi.fn()}
        onSendToDevice={vi.fn()}
        deviceReady
      />
    )

    expect(html).toContain('发送到设备')
  })

  it('shows progress while the pattern is being sent', () => {
    const html = renderToStaticMarkup(
      <PixelEditorH5
        matrix={[[null]]}
        colors={[]}
        presets={{}}
        palettePreset='full'
        boardLabel='104 × 104'
        onChange={vi.fn()}
        onPalettePresetChange={vi.fn()}
        onSave={vi.fn()}
        onSendToDevice={vi.fn()}
        isSendingToDevice
      />
    )

    expect(html).toContain('正在发送...')
    expect(html).toContain('disabled')
  })
})
