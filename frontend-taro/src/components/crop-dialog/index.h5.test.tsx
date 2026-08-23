import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CropDialogH5 } from './index.h5'

describe('CropDialogH5', () => {
  it('renders the selected board as a real column-by-row calibration grid', () => {
    const markup = renderToStaticMarkup(
      <CropDialogH5
        open
        imageUrl='blob:test-image'
        cropImageRef={createRef<HTMLImageElement>()}
        cropImageStyle={{}}
        cropBoxStyle={{ left: '0px', top: '0px', width: '520px', height: '370px' }}
        boardLabel='104 × 74'
        gridWidth={104}
        gridHeight={74}
        zoom={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onReset={vi.fn()}
        onZoomChange={vi.fn()}
        onMouseDown={vi.fn()}
        onTouchStart={vi.fn()}
      />
    )

    expect(markup).toContain('104 列 × 74 行')
    expect(markup).toContain('aria-label="104 列 74 行校准网格"')
    expect(markup).toContain(
      'background-size:calc(100% / 104) calc(100% / 74)'
    )
    expect(markup).toContain('智能像素化并生成')
    expect(markup).not.toContain('智能识别')
  })
})
