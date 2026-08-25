import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CropDialogH5, type CropDialogH5Props } from './index.h5'

function buildProps(overrides: Partial<CropDialogH5Props> = {}): CropDialogH5Props {
  return {
    open: true,
    step: 'align',
    progress: 0,
    imageUrl: 'blob:test-image',
    cropImageRef: createRef<HTMLImageElement>(),
    cropImageStyle: {},
    cropBoxStyle: { left: '0px', top: '0px', width: '520px', height: '370px' },
    boardLabel: '104 × 74',
    gridWidth: 104,
    gridHeight: 74,
    zoom: 1,
    importMode: 'pixel-art',
    paletteOptions: [{ id: '221', label: '221 Full Set' }],
    selectedPalette: '221',
    boardOptions: [{ id: '104x74', label: '104 × 74' }],
    selectedBoard: '104x74',
    colorStyle: 'natural',
    pixelMatrix: Array.from({ length: 74 }, () => Array<string | null>(104).fill(null)),
    paletteColors: [{ code: 'A1', name: 'White', name_zh: '白', hex: '#ffffff', rgb: [255, 255, 255] }],
    colorSummary: [],
    totalBeads: 0,
    onCancel: vi.fn(),
    onChooseFile: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onConfirm: vi.fn(),
    onFinish: vi.fn(),
    onOpenCorrection: vi.fn(),
    onPatternChange: vi.fn(),
    onReset: vi.fn(),
    onZoomChange: vi.fn(),
    onNudge: vi.fn(),
    onPaletteChange: vi.fn(),
    onBoardChange: vi.fn(),
    onColorStyleChange: vi.fn(),
    onMouseDown: vi.fn(),
    onTouchStart: vi.fn(),
    ...overrides
  }
}

describe('CropDialogH5', () => {
  it('renders the three-step pixel-art guide and real grid calibration controls', () => {
    const guide = renderToStaticMarkup(<CropDialogH5 {...buildProps({ step: 'guide' })} />)
    const align = renderToStaticMarkup(<CropDialogH5 {...buildProps()} />)

    expect(guide).toContain('操作指引')
    expect(guide).toContain('手机相册 / 选择文件')
    expect(align).toContain('步骤2/3：网格校准')
    expect(align).toContain('位置微调')
    expect(align).toContain('单格大小微调')
    expect(align).toContain('aria-label="104 列 74 行校准网格"')
    expect(align).toContain('background-size:calc(100% / 104) calc(100% / 74)')
  })

  it('renders one fixed-size result preview without a recognition-quality choice', () => {
    const markup = renderToStaticMarkup(
      <CropDialogH5
        {...buildProps({
          step: 'result',
          importMode: 'photo',
          pixelMatrix: Array.from({ length: 29 }, () => Array<string | null>(29).fill('A1')),
          totalBeads: 841
        })}
      />
    )

    expect(markup).toContain('颜色套餐（颜色数量）')
    expect(markup).toContain('钉板尺寸')
    expect(markup).toContain('固定画框预览 29 × 29')
    expect(markup).toContain('开始创作')
    expect(markup).not.toContain('高精度')
    expect(markup).not.toContain('快速本地')
  })

  it('exposes the complete color-correction action set from the reference flow', () => {
    const markup = renderToStaticMarkup(
      <CropDialogH5
        {...buildProps({
          step: 'correction',
          pixelMatrix: [['A1']],
          colorSummary: [{ code: 'A1', hex: '#ffffff', count: 1 }],
          totalBeads: 1
        })}
      />
    )

    expect(markup).toContain('页内全选')
    expect(markup).toContain('>全选<')
    expect(markup).toContain('取消选择')
    expect(markup).toContain('反选')
    expect(markup).toContain('修改色号')
    expect(markup).toContain('删除')
    expect(markup).toContain('完成并编辑')
  })
})
