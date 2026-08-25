import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type TouchEvent
} from 'react'
import { getCalibrationGridBackgroundSize } from '@/features/image-calibration/model'
import { buildFixedBoardPreviewLayout } from '@/features/image-calibration/preview-layout'
import type { ColorSummaryItem, PaletteColor, PixelMatrix } from '@/types/api'
import './index.h5.scss'

export type ImportWorkflowStep =
  | 'guide'
  | 'align'
  | 'crop'
  | 'recognizing'
  | 'result'
  | 'correction'

export interface CropDialogH5Props {
  open: boolean
  step: ImportWorkflowStep
  progress: number
  imageUrl: string
  cropImageRef: RefObject<HTMLImageElement | null>
  cropImageStyle: CSSProperties
  cropBoxStyle: CSSProperties
  boardLabel: string
  gridWidth: number
  gridHeight: number
  zoom: number
  modeHint?: string
  importMode: 'photo' | 'pixel-art'
  paletteOptions: Array<{ id: string; label: string }>
  selectedPalette: string
  boardOptions: Array<{ id: string; label: string }>
  selectedBoard: string
  colorStyle: 'natural' | 'vivid' | 'soft'
  pixelMatrix: PixelMatrix
  paletteColors: PaletteColor[]
  colorSummary: ColorSummaryItem[]
  totalBeads: number
  onCancel: () => void
  onChooseFile: () => void
  onPrevious: () => void
  onNext: () => void
  onConfirm: () => void
  onFinish: () => void
  onOpenCorrection: () => void
  onPatternChange: (matrix: PixelMatrix) => void
  onReset: () => void
  onZoomChange: (zoom: number) => void
  onNudge: (deltaX: number, deltaY: number) => void
  onPaletteChange: (palette: string) => void
  onBoardChange: (boardId: string) => void
  onColorStyleChange: (style: 'natural' | 'vivid' | 'soft') => void
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
}

const PREVIEW_BITMAP_SIZE = 624

function cellKey(x: number, y: number) {
  return `${x}:${y}`
}

function PatternPreviewCanvas({
  matrix,
  colors,
  selectedCells,
  selectable,
  onToggleCell
}: {
  matrix: PixelMatrix
  colors: PaletteColor[]
  selectedCells: Set<string>
  selectable: boolean
  onToggleCell: (x: number, y: number, force?: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragActionRef = useRef(true)
  const columns = matrix[0]?.length ?? 1
  const rows = Math.max(1, matrix.length)
  const layout = useMemo(
    () => buildFixedBoardPreviewLayout(columns, rows, PREVIEW_BITMAP_SIZE),
    [columns, rows]
  )
  const colorLookup = useMemo(
    () => new Map(colors.map((color) => [color.code, color.hex])),
    [colors]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = layout.bitmapSize
    canvas.height = layout.bitmapSize
    const context = canvas.getContext('2d')
    if (!context) return

    context.imageSmoothingEnabled = false
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    matrix.forEach((row, y) => {
      row.forEach((code, x) => {
        context.fillStyle = code ? colorLookup.get(code) ?? '#d9d9d9' : '#ffffff'
        context.fillRect(
          layout.offsetX + x * layout.cellSize,
          layout.offsetY + y * layout.cellSize,
          layout.cellSize,
          layout.cellSize
        )
      })
    })

    if (layout.cellSize >= 4) {
      context.beginPath()
      context.strokeStyle = layout.cellSize >= 10
        ? 'rgba(72, 88, 104, 0.22)'
        : 'rgba(72, 88, 104, 0.13)'
      context.lineWidth = Math.min(1, Math.max(0.35, layout.cellSize * 0.08))
      for (let x = 0; x <= columns; x += 1) {
        const lineX = layout.offsetX + x * layout.cellSize
        context.moveTo(lineX, layout.offsetY)
        context.lineTo(lineX, layout.offsetY + rows * layout.cellSize)
      }
      for (let y = 0; y <= rows; y += 1) {
        const lineY = layout.offsetY + y * layout.cellSize
        context.moveTo(layout.offsetX, lineY)
        context.lineTo(layout.offsetX + columns * layout.cellSize, lineY)
      }
      context.stroke()
    }

    if (selectedCells.size > 0) {
      context.fillStyle = 'rgba(20, 196, 220, 0.34)'
      context.strokeStyle = '#08a8c7'
      context.lineWidth = Math.max(1, Math.min(3, layout.cellSize * 0.2))
      selectedCells.forEach((key) => {
        const [x, y] = key.split(':').map(Number)
        if (x < 0 || y < 0 || x >= columns || y >= rows) return
        const left = layout.offsetX + x * layout.cellSize
        const top = layout.offsetY + y * layout.cellSize
        context.fillRect(left, top, layout.cellSize, layout.cellSize)
        context.strokeRect(left, top, layout.cellSize, layout.cellSize)
      })
    }
  }, [colorLookup, columns, layout, matrix, rows, selectedCells])

  function getPointerCell(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const bitmapX = (event.clientX - rect.left) * (layout.bitmapSize / rect.width)
    const bitmapY = (event.clientY - rect.top) * (layout.bitmapSize / rect.height)
    const x = Math.floor((bitmapX - layout.offsetX) / layout.cellSize)
    const y = Math.floor((bitmapY - layout.offsetY) / layout.cellSize)
    if (x < 0 || y < 0 || x >= columns || y >= rows) return null
    return { x, y }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!selectable) return
    const cell = getPointerCell(event)
    if (!cell) return
    const key = cellKey(cell.x, cell.y)
    dragActionRef.current = !selectedCells.has(key)
    event.currentTarget.setPointerCapture(event.pointerId)
    onToggleCell(cell.x, cell.y, dragActionRef.current)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!selectable || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const cell = getPointerCell(event)
    if (cell) onToggleCell(cell.x, cell.y, dragActionRef.current)
  }

  return (
    <div className='import-workflow__fixed-preview'>
      <canvas
        ref={canvasRef}
        aria-label={`固定画框预览 ${columns} × ${rows}`}
        data-cell-size={layout.cellSize.toFixed(3)}
        className={`import-workflow__fixed-preview-canvas${selectable ? ' is-selectable' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      />
    </div>
  )
}

export function CropDialogH5({
  open,
  step,
  progress,
  imageUrl,
  cropImageRef,
  cropImageStyle,
  cropBoxStyle,
  boardLabel,
  gridWidth,
  gridHeight,
  zoom,
  modeHint,
  importMode,
  paletteOptions,
  selectedPalette,
  boardOptions,
  selectedBoard,
  colorStyle,
  pixelMatrix,
  paletteColors,
  colorSummary,
  totalBeads,
  onCancel,
  onChooseFile,
  onPrevious,
  onNext,
  onConfirm,
  onFinish,
  onOpenCorrection,
  onPatternChange,
  onReset,
  onZoomChange,
  onNudge,
  onPaletteChange,
  onBoardChange,
  onColorStyleChange,
  onMouseDown,
  onTouchStart
}: CropDialogH5Props) {
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set())
  const [replacementCode, setReplacementCode] = useState('')
  const calibrationGridStyle: CSSProperties = {
    ...cropBoxStyle,
    backgroundSize: getCalibrationGridBackgroundSize(gridWidth, gridHeight)
  }

  useEffect(() => {
    setSelectedCells(new Set())
  }, [pixelMatrix.length, pixelMatrix[0]?.length, step])

  useEffect(() => {
    if (!paletteColors.some((color) => color.code === replacementCode)) {
      setReplacementCode(paletteColors[0]?.code ?? '')
    }
  }, [paletteColors, replacementCode])

  function toggleCell(x: number, y: number, force?: boolean) {
    const key = cellKey(x, y)
    setSelectedCells((current) => {
      const next = new Set(current)
      const shouldSelect = force ?? !next.has(key)
      if (shouldSelect) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function selectAllPlacedCells() {
    const next = new Set<string>()
    pixelMatrix.forEach((row, y) => {
      row.forEach((code, x) => {
        if (code) next.add(cellKey(x, y))
      })
    })
    setSelectedCells(next)
  }

  function invertSelection() {
    const next = new Set<string>()
    pixelMatrix.forEach((row, y) => {
      row.forEach((_code, x) => {
        const key = cellKey(x, y)
        if (!selectedCells.has(key)) next.add(key)
      })
    })
    setSelectedCells(next)
  }

  function updateSelectedCells(code: string | null) {
    if (selectedCells.size === 0) return
    const next = pixelMatrix.map((row, y) =>
      row.map((cell, x) => selectedCells.has(cellKey(x, y)) ? code : cell)
    )
    onPatternChange(next)
    setSelectedCells(new Set())
  }

  const title = importMode === 'photo' ? '导入图片' : '导入图纸'
  const currentStepNumber = step === 'guide' ? 1 : step === 'align' ? 2 : step === 'crop' ? 3 : 4
  const showStepRail = importMode === 'pixel-art' && !['result', 'correction'].includes(step)

  return (
    <div id='crop-dialog' className='modal modal-crop' style={{ display: open ? 'flex' : 'none' }}>
      <div className='modal-content modal-content-crop import-workflow'>
        <header className='import-workflow__header'>
          <button aria-label='返回上一步' type='button' onClick={step === 'guide' ? onCancel : onPrevious}>←</button>
          <h3>{step === 'correction' ? '色号校对' : title}</h3>
          <button aria-label='关闭导入流程' type='button' onClick={onCancel}>×</button>
        </header>

        {showStepRail ? (
          <div className='import-workflow__step-rail' aria-label='导入图纸流程'>
            {[1, 2, 3].map((item) => <span key={item} className={currentStepNumber >= item ? 'is-active' : ''}>{item}</span>)}
          </div>
        ) : null}

        {step === 'guide' ? (
          <main className='import-workflow__guide'>
            <section>
              <strong>操作指引</strong>
              <p><b>1</b> 上传带网格或色号的拼豆图纸</p>
              <p><b>2</b> 微调网格位置与单格大小，使网格准确重合</p>
              <p><b>3</b> 调整裁剪范围，自动识别色号并生成图纸</p>
            </section>
            <section className='import-workflow__choose-card'>
              <strong>步骤1/3：选择图纸</strong>
              <button type='button' onClick={onChooseFile}>手机相册 / 选择文件</button>
            </section>
          </main>
        ) : null}

        {step === 'align' || step === 'crop' ? (
          <main className='import-workflow__calibration'>
            <div className='import-workflow__stage-title'>
              <strong>步骤{step === 'align' ? '2' : '3'}/3：{step === 'align' ? '网格校准' : '选择裁剪区域'}</strong>
              <span>{step === 'align' ? '让网格线与图片像素格准确重合' : '图案以外区域可留白，输出画布大小保持不变'}</span>
            </div>
            <div className='modal-body modal-body-crop'>
              <div id='crop-container' className='crop-surface'>
                <img id='crop-image' ref={cropImageRef} src={imageUrl} className='crop-image' style={cropImageStyle} />
                <div
                  id='crop-box'
                  className='crop-box'
                  aria-label={`${gridWidth} 列 ${gridHeight} 行校准网格`}
                  onMouseDown={onMouseDown}
                  onTouchStart={onTouchStart}
                  style={calibrationGridStyle}
                />
              </div>
            </div>
            {step === 'align' ? (
              <div className='import-workflow__micro-controls'>
                <section>
                  <strong>位置微调</strong>
                  <div className='import-workflow__dpad'>
                    <button aria-label='向上微调' type='button' onClick={() => onNudge(0, -1)}>↑</button>
                    <button aria-label='向左微调' type='button' onClick={() => onNudge(-1, 0)}>←</button>
                    <button aria-label='向下微调' type='button' onClick={() => onNudge(0, 1)}>↓</button>
                    <button aria-label='向右微调' type='button' onClick={() => onNudge(1, 0)}>→</button>
                  </div>
                </section>
                <section>
                  <strong>单格大小微调</strong>
                  <div className='import-workflow__size-control'>
                    <button aria-label='缩小网格单格' disabled={zoom <= 1} type='button' onClick={() => onZoomChange(zoom - 0.05)}>−</button>
                    <span>{zoom.toFixed(2)}</span>
                    <button aria-label='放大网格单格' disabled={zoom >= 3} type='button' onClick={() => onZoomChange(zoom + 0.05)}>＋</button>
                  </div>
                  <button className='import-workflow__reset' type='button' onClick={onReset}>复位</button>
                </section>
              </div>
            ) : (
              <div className='import-workflow__crop-note'>
                <strong>生成尺寸</strong>
                <span>{gridWidth} × {gridHeight}</span>
                <small>可拖动蓝框调整识别区域；图案会在 {boardLabel} 画布中居中留白。</small>
              </div>
            )}
            <footer className='import-workflow__footer-pair'>
              <button type='button' onClick={onPrevious}>上一步</button>
              <button className='is-primary' type='button' onClick={step === 'align' ? onNext : onConfirm}>
                {step === 'align' ? '下一步' : '开始识别'}
              </button>
            </footer>
          </main>
        ) : null}

        {step === 'recognizing' ? (
          <main className='import-workflow__recognizing' aria-live='polite'>
            <div className='import-workflow__spinner' />
            <strong>正在识别色号并生成图纸…</strong>
            <div className='import-workflow__progress'><span style={{ width: `${progress}%` }} /></div>
            <b>{Math.round(progress)}%</b>
            <small>全程在本机完成，不上传图片</small>
          </main>
        ) : null}

        {step === 'result' ? (
          <main className='import-workflow__result'>
            <section className='import-workflow__settings' aria-label='图纸设置'>
              {importMode === 'photo' ? (
                <div>
                  <strong>配色方案</strong>
                  <div className='import-workflow__choice-strip'>
                    {(['natural', 'vivid', 'soft'] as const).map((style) => (
                      <button key={style} className={colorStyle === style ? 'is-selected' : ''} type='button' onClick={() => onColorStyleChange(style)}>
                        {{ natural: '默认', vivid: '鲜艳', soft: '柔和' }[style]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <strong>颜色套餐（颜色数量）</strong>
                <div className='import-workflow__choice-strip'>
                  {paletteOptions.map((option) => (
                    <button key={option.id} className={selectedPalette === option.id ? 'is-selected' : ''} type='button' onClick={() => onPaletteChange(option.id)}>
                      {/^[0-9]+$/.test(option.id) ? `${option.id}色` : option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <strong>钉板尺寸</strong>
                <div className='import-workflow__choice-strip'>
                  {boardOptions.map((option) => (
                    <button key={option.id} className={selectedBoard === option.id ? 'is-selected' : ''} type='button' onClick={() => onBoardChange(option.id)}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            {importMode === 'pixel-art' ? (
              <section className='import-workflow__summary'>
                <strong>包含以下 {colorSummary.length} 种颜色（总计 {totalBeads} 颗）</strong>
                <div>{colorSummary.map((item) => <span key={item.code} style={{ background: item.hex }}>{item.code}<small>{item.count}</small></span>)}</div>
              </section>
            ) : null}
            <PatternPreviewCanvas matrix={pixelMatrix} colors={paletteColors} selectedCells={selectedCells} selectable={false} onToggleCell={toggleCell} />
            <footer className='import-workflow__result-actions'>
              {importMode === 'pixel-art' ? <button type='button' onClick={onOpenCorrection}>色号校对</button> : null}
              <button className='is-primary' type='button' onClick={onFinish}>{importMode === 'photo' ? '开始创作' : '编辑'}</button>
            </footer>
          </main>
        ) : null}

        {step === 'correction' ? (
          <main className='import-workflow__correction'>
            <p>单击或滑动选择格子，再批量修改色号或删除。</p>
            <PatternPreviewCanvas matrix={pixelMatrix} colors={paletteColors} selectedCells={selectedCells} selectable onToggleCell={toggleCell} />
            <div className='import-workflow__selection-actions'>
              <span>已选 {selectedCells.size}</span>
              <button type='button' onClick={selectAllPlacedCells}>页内全选</button>
              <button type='button' onClick={selectAllPlacedCells}>全选</button>
              <button type='button' onClick={invertSelection}>反选</button>
              <button type='button' disabled={selectedCells.size === 0} onClick={() => setSelectedCells(new Set())}>取消选择</button>
              <button type='button' disabled={selectedCells.size === 0 || !replacementCode} onClick={() => updateSelectedCells(replacementCode)}>修改色号</button>
              <button className='is-danger' type='button' disabled={selectedCells.size === 0} onClick={() => updateSelectedCells(null)}>删除</button>
            </div>
            <div className='import-workflow__palette-strip' aria-label='选择替换色号'>
              {paletteColors.map((color) => (
                <button
                  key={color.code}
                  aria-label={`替换为 ${color.code}`}
                  className={replacementCode === color.code ? 'is-selected' : ''}
                  style={{ background: color.hex }}
                  type='button'
                  onClick={() => setReplacementCode(color.code)}
                >{color.code}</button>
              ))}
            </div>
            <footer className='import-workflow__footer-pair'>
              <button type='button' onClick={onPrevious}>返回结果</button>
              <button className='is-primary' type='button' onClick={onFinish}>完成并编辑</button>
            </footer>
          </main>
        ) : null}

        {modeHint && step === 'result' ? <p className='import-workflow__hint'>{modeHint}</p> : null}
      </div>
    </div>
  )
}
