import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { PaletteColor, PalettePresetMap, PixelMatrix } from '@/types/api'
import backIcon from '@/assets/v13/common/back.png'
import clearActiveIcon from '@/assets/v13/editor/clear-active.png'
import clearIcon from '@/assets/v13/editor/clear.png'
import eraserActiveIcon from '@/assets/v13/editor/eraser-active.png'
import eraserIcon from '@/assets/v13/editor/eraser.png'
import fillActiveIcon from '@/assets/v13/editor/fill-active.png'
import fillIcon from '@/assets/v13/editor/fill.png'
import numbersActiveIcon from '@/assets/v13/editor/numbers-active.png'
import numbersIcon from '@/assets/v13/editor/numbers.png'
import redoActiveIcon from '@/assets/v13/editor/redo-active.png'
import redoIcon from '@/assets/v13/editor/redo.png'
import saveIcon from '@/assets/v13/editor/save.png'
import undoActiveIcon from '@/assets/v13/editor/undo-active.png'
import undoIcon from '@/assets/v13/editor/undo.png'
import {
  applyPaletteToPixelMatrix,
  clonePixelMatrix,
  createEmptyPixelMatrix,
  floodFillPixelMatrix,
  getPresetColors,
  mirrorPixelMatrixHorizontally,
  matricesEqual,
  rasterizeGridLine,
  rotatePixelMatrixClockwise,
  setPixelCell
} from './model'
import './index.h5.scss'

type EditorTool = 'pen' | 'eyedropper' | 'eraser' | 'fill' | 'select' | 'pan'

const HISTORY_LIMIT = 40
const EDITOR_TOOLS: Array<{
  value: EditorTool
  label: string
  icon?: string
  activeIcon?: string
  glyph?: string
}> = [
  { value: 'pen', label: '画笔', glyph: '✎' },
  { value: 'eyedropper', label: '吸管', glyph: '⌾' },
  { value: 'eraser', label: '橡皮擦', icon: eraserIcon, activeIcon: eraserActiveIcon },
  { value: 'fill', label: '填充', icon: fillIcon, activeIcon: fillActiveIcon },
  { value: 'select', label: '选格', glyph: '✓' },
  { value: 'pan', label: '移动', glyph: '↔' }
]

export interface PixelEditorH5Props {
  matrix: PixelMatrix
  colors: PaletteColor[]
  presets: PalettePresetMap
  palettePreset: string
  boardLabel: string
  onBack?: () => void
  onChange: (matrix: PixelMatrix) => void
  onPalettePresetChange: (preset: string) => void
  onSave: () => void
  onCloudSave?: () => void
  isCloudSaving?: boolean
  cloudSaved?: boolean
  localSaveFailed?: boolean
}

function getBaseCellSize(matrix: PixelMatrix) {
  const maxDimension = Math.max(matrix.length, matrix[0]?.length ?? 1)
  return Math.max(4, Math.min(12, Math.floor(520 / maxDimension)))
}

function getCellSize(matrix: PixelMatrix, zoom: number) {
  return Math.max(2, Math.round(getBaseCellSize(matrix) * zoom))
}

export function PixelEditorH5({
  matrix,
  colors,
  presets,
  palettePreset,
  boardLabel,
  onBack,
  onChange,
  onPalettePresetChange,
  onSave,
  onCloudSave,
  isCloudSaving = false,
  cloudSaved = false,
  localSaveFailed = false
}: PixelEditorH5Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const workingMatrixRef = useRef<PixelMatrix>(clonePixelMatrix(matrix))
  const strokeStartRef = useRef<PixelMatrix | null>(null)
  const drawingRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const lastCellRef = useRef<{ x: number; y: number } | null>(null)
  const selectionActionRef = useRef(true)
  const panStartRef = useRef<{
    clientX: number
    clientY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [workingMatrix, setWorkingMatrix] = useState(() => clonePixelMatrix(matrix))
  const [undoStack, setUndoStack] = useState<PixelMatrix[]>([])
  const [redoStack, setRedoStack] = useState<PixelMatrix[]>([])
  const [tool, setTool] = useState<EditorTool>('pen')
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedPreset, setSelectedPreset] = useState(palettePreset)
  const [zoom, setZoom] = useState(1)
  const [showCodes, setShowCodes] = useState(false)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set())

  const presetColors = useMemo(
    () => getPresetColors(colors, presets, selectedPreset),
    [colors, presets, selectedPreset]
  )
  const colorLookup = useMemo(
    () => new Map(colors.map((color) => [color.code, color])),
    [colors]
  )
  const cellSize = getCellSize(workingMatrix, zoom)
  const canvasWidth = (workingMatrix[0]?.length ?? 1) * cellSize
  const canvasHeight = Math.max(1, workingMatrix.length) * cellSize

  useEffect(() => {
    workingMatrixRef.current = workingMatrix
  }, [workingMatrix])

  useEffect(() => {
    if (matricesEqual(matrix, workingMatrixRef.current)) {
      return
    }

    const next = clonePixelMatrix(matrix)
    workingMatrixRef.current = next
    setWorkingMatrix(next)
    setUndoStack([])
    setRedoStack([])
  }, [matrix])

  useEffect(() => {
    setSelectedPreset(palettePreset)
  }, [palettePreset])

  useEffect(() => {
    if (presetColors.length === 0) {
      setSelectedCode('')
      return
    }

    if (!presetColors.some((color) => color.code === selectedCode)) {
      setSelectedCode(presetColors[0].code)
    }
  }, [presetColors, selectedCode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    workingMatrix.forEach((row, y) => {
      row.forEach((code, x) => {
        context.fillStyle = code ? colorLookup.get(code)?.hex ?? '#e2e8f0' : '#ffffff'
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
      })
    })

    if (cellSize >= 5) {
      context.beginPath()
      context.strokeStyle = cellSize >= 9 ? 'rgba(15, 23, 42, 0.16)' : 'rgba(15, 23, 42, 0.1)'
      context.lineWidth = 1

      for (let x = 0; x <= (workingMatrix[0]?.length ?? 0); x += 1) {
        context.moveTo(x * cellSize + 0.5, 0)
        context.lineTo(x * cellSize + 0.5, canvasHeight)
      }
      for (let y = 0; y <= workingMatrix.length; y += 1) {
        context.moveTo(0, y * cellSize + 0.5)
        context.lineTo(canvasWidth, y * cellSize + 0.5)
      }
      context.stroke()
    }

    if (showCodes && cellSize >= 11) {
      context.fillStyle = 'rgba(48, 32, 18, 0.74)'
      context.font = `700 ${Math.max(6, Math.floor(cellSize * 0.28))}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      workingMatrix.forEach((row, y) => {
        row.forEach((code, x) => {
          if (!code) return
          context.fillText(
            code,
            x * cellSize + cellSize / 2,
            y * cellSize + cellSize / 2,
            cellSize - 2
          )
        })
      })
    }

    if (selectedCells.size > 0) {
      context.fillStyle = 'rgba(35, 199, 220, 0.28)'
      context.strokeStyle = '#06b6d4'
      context.lineWidth = Math.max(1, Math.min(3, cellSize * 0.18))
      selectedCells.forEach((key) => {
        const [x, y] = key.split(':').map(Number)
        if (!Number.isInteger(x) || !Number.isInteger(y)) return
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
        context.strokeRect(
          x * cellSize + context.lineWidth / 2,
          y * cellSize + context.lineWidth / 2,
          Math.max(0, cellSize - context.lineWidth),
          Math.max(0, cellSize - context.lineWidth)
        )
      })
    }
  }, [canvasHeight, canvasWidth, cellSize, colorLookup, selectedCells, showCodes, workingMatrix])

  function recordChange(previous: PixelMatrix, next: PixelMatrix) {
    if (matricesEqual(previous, next)) {
      return
    }

    setUndoStack((items) => [...items, clonePixelMatrix(previous)].slice(-HISTORY_LIMIT))
    setRedoStack([])
    workingMatrixRef.current = next
    setWorkingMatrix(next)
    onChange(next)
  }

  function resolvePointerCell(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }

    const bounds = canvas.getBoundingClientRect()
    const x = Math.floor(((event.clientX - bounds.left) * canvas.width) / bounds.width / cellSize)
    const y = Math.floor(((event.clientY - bounds.top) * canvas.height) / bounds.height / cellSize)

    if (
      x < 0 ||
      y < 0 ||
      y >= workingMatrixRef.current.length ||
      x >= (workingMatrixRef.current[y]?.length ?? 0)
    ) {
      return null
    }

    return { x, y }
  }

  function paintAtPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = resolvePointerCell(event)
    if (!cell) {
      return
    }

    const previousCell = lastCellRef.current
    if (previousCell?.x === cell.x && previousCell.y === cell.y) {
      return
    }
    lastCellRef.current = cell

    const code = tool === 'eraser' ? null : selectedCode || null
    const cells = previousCell
      ? rasterizeGridLine(previousCell, cell).slice(1)
      : [cell]
    let next = workingMatrixRef.current
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    for (const target of cells) {
      const previous = next
      next = setPixelCell(next, target.x, target.y, code)
      if (next === previous || !context) continue

      context.fillStyle = code
        ? colorLookup.get(code)?.hex ?? '#e2e8f0'
        : '#ffffff'
      context.fillRect(
        target.x * cellSize,
        target.y * cellSize,
        cellSize,
        cellSize
      )
      if (cellSize >= 5) {
        context.strokeStyle =
          cellSize >= 9
            ? 'rgba(15, 23, 42, 0.16)'
            : 'rgba(15, 23, 42, 0.1)'
        context.lineWidth = 1
        context.strokeRect(
          target.x * cellSize + 0.5,
          target.y * cellSize + 0.5,
          cellSize,
          cellSize
        )
      }
    }

    workingMatrixRef.current = next
  }

  function selectAtPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = resolvePointerCell(event)
    if (!cell) return

    const previousCell = lastCellRef.current
    if (previousCell?.x === cell.x && previousCell.y === cell.y) return
    lastCellRef.current = cell
    const key = `${cell.x}:${cell.y}`
    setSelectedCells((current) => {
      const next = new Set(current)
      if (selectionActionRef.current) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerIdRef.current !== null) {
      return
    }

    const cell = resolvePointerCell(event)
    if (!cell) {
      return
    }

    event.preventDefault()
    lastCellRef.current = null

    if (tool === 'pan') {
      const viewport = viewportRef.current
      if (!viewport) return
      activePointerIdRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      panStartRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop
      }
      return
    }

    if (tool === 'eyedropper') {
      const code = workingMatrixRef.current[cell.y]?.[cell.x]
      if (code) {
        setSelectedCode(code)
        setTool('pen')
      }
      return
    }

    if (tool === 'select') {
      const key = `${cell.x}:${cell.y}`
      selectionActionRef.current = !selectedCells.has(key)
      activePointerIdRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      drawingRef.current = true
      selectAtPointer(event)
      return
    }

    if (tool === 'fill') {
      const previous = workingMatrixRef.current
      const next = floodFillPixelMatrix(previous, cell.x, cell.y, selectedCode || null)
      recordChange(previous, next)
      return
    }

    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    strokeStartRef.current = clonePixelMatrix(workingMatrixRef.current)
    paintAtPointer(event)
  }

  function finishStroke(event?: ReactPointerEvent<HTMLCanvasElement>) {
    if (
      panStartRef.current &&
      (!event || activePointerIdRef.current === event.pointerId)
    ) {
      panStartRef.current = null
      activePointerIdRef.current = null
      return
    }
    if (
      !drawingRef.current ||
      (event && activePointerIdRef.current !== event.pointerId)
    ) {
      return
    }

    drawingRef.current = false
    activePointerIdRef.current = null
    lastCellRef.current = null
    if (tool === 'select') {
      strokeStartRef.current = null
      return
    }
    const previous = strokeStartRef.current
    strokeStartRef.current = null
    if (!previous) {
      return
    }

    recordChange(previous, workingMatrixRef.current)
  }

  function fitCanvasToViewport() {
    const viewport = viewportRef.current
    const columns = workingMatrixRef.current[0]?.length ?? 1
    const rows = Math.max(1, workingMatrixRef.current.length)
    if (!viewport) return

    const availableWidth = Math.max(1, viewport.clientWidth - 26)
    const availableHeight = Math.max(1, viewport.clientHeight - 26)
    const baseCellSize = getBaseCellSize(workingMatrixRef.current)
    const nextZoom = Math.min(
      1,
      availableWidth / (columns * baseCellSize),
      availableHeight / (rows * baseCellSize)
    )
    setZoom(Math.max(0.4, nextZoom))
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fitCanvasToViewport())
    return () => window.cancelAnimationFrame(frame)
  }, [workingMatrix.length, workingMatrix[0]?.length])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (!viewport) return
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [canvasHeight, canvasWidth])

  function undo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) {
      return
    }

    const current = clonePixelMatrix(workingMatrixRef.current)
    const next = clonePixelMatrix(previous)
    setUndoStack((items) => items.slice(0, -1))
    setRedoStack((items) => [...items, current].slice(-HISTORY_LIMIT))
    workingMatrixRef.current = next
    setWorkingMatrix(next)
    onChange(next)
  }

  function redo() {
    const nextEntry = redoStack[redoStack.length - 1]
    if (!nextEntry) {
      return
    }

    const current = clonePixelMatrix(workingMatrixRef.current)
    const next = clonePixelMatrix(nextEntry)
    setRedoStack((items) => items.slice(0, -1))
    setUndoStack((items) => [...items, current].slice(-HISTORY_LIMIT))
    workingMatrixRef.current = next
    setWorkingMatrix(next)
    onChange(next)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select')) {
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [redoStack, undoStack])

  function applySelectedPalette() {
    const previous = workingMatrixRef.current
    const next = applyPaletteToPixelMatrix(previous, colors, presets, selectedPreset)
    onPalettePresetChange(selectedPreset)
    recordChange(previous, next)
  }

  function clearCanvas() {
    if (!window.confirm('确定清空当前画布吗？这一步可以撤销。')) {
      return
    }

    const previous = workingMatrixRef.current
    const next = createEmptyPixelMatrix(previous[0]?.length ?? 1, previous.length)
    recordChange(previous, next)
  }

  function mirrorCanvas() {
    const previous = workingMatrixRef.current
    recordChange(previous, mirrorPixelMatrixHorizontally(previous))
  }

  function rotateCanvas() {
    const previous = workingMatrixRef.current
    if (previous.length !== (previous[0]?.length ?? 0)) {
      return
    }
    recordChange(previous, rotatePixelMatrixClockwise(previous))
  }

  function selectAllPlacedCells() {
    const next = new Set<string>()
    workingMatrixRef.current.forEach((row, y) => {
      row.forEach((code, x) => {
        if (code) next.add(`${x}:${y}`)
      })
    })
    setSelectedCells(next)
    setTool('select')
  }

  function invertPlacedSelection() {
    setSelectedCells((current) => {
      const next = new Set<string>()
      workingMatrixRef.current.forEach((row, y) => {
        row.forEach((code, x) => {
          const key = `${x}:${y}`
          if (code && !current.has(key)) next.add(key)
        })
      })
      return next
    })
    setTool('select')
  }

  function updateSelectedCells(code: string | null) {
    if (selectedCells.size === 0) return
    const previous = workingMatrixRef.current
    let next = previous
    selectedCells.forEach((key) => {
      const [x, y] = key.split(':').map(Number)
      next = setPixelCell(next, x, y, code)
    })
    recordChange(previous, next)
    setSelectedCells(new Set())
  }

  return (
    <section className='pixel-editor' aria-label='拼豆像素编辑器'>
      <div className='pixel-editor__header'>
        {onBack ? (
          <button className='pixel-editor__back' type='button' onClick={onBack} aria-label='返回首页'>
            <img src={backIcon} alt='' />
          </button>
        ) : (
          <span className='pixel-editor__header-spacer' aria-hidden='true' />
        )}
        <div className='pixel-editor__heading-copy'>
          <div className='pixel-editor__eyebrow'>{boardLabel} 钉板</div>
          <h2 className='pixel-editor__title'>创作</h2>
          <p className='pixel-editor__subtitle'>点击或拖动涂色，支持撤销、填充和缩放查看。</p>
        </div>
        <div className='pixel-editor__save-group'>
          <span className='pixel-editor__local-status'>
            {localSaveFailed
              ? '应用内草稿保存失败'
              : cloudSaved
                ? '应用内草稿 + 私有云已保存'
                : '应用内草稿已保存'}
          </span>
          <button className='pixel-editor__save-button' type='button' onClick={onSave}>
            <img src={saveIcon} alt='' />
            <span>保存</span>
          </button>
          {onCloudSave ? (
            <button
              className='pixel-editor__save-button pixel-editor__save-button--cloud'
              type='button'
              disabled={isCloudSaving}
              onClick={onCloudSave}
            >
              {isCloudSaving ? '云端保存中...' : '保存到私有云'}
            </button>
          ) : null}
        </div>
      </div>

      <div className='pixel-editor__toolbar' aria-label='绘图工具'>
        <div className='pixel-editor__tool-group'>
          {EDITOR_TOOLS.map((item) => {
            const active = tool === item.value
            return (
              <button
                key={item.value}
                className={`pixel-editor__tool ${active ? 'pixel-editor__tool--active' : ''}`}
                type='button'
                aria-pressed={active}
                onClick={() => setTool(item.value)}
              >
                {item.icon ? (
                  <img src={active ? item.activeIcon : item.icon} alt='' />
                ) : (
                  <span className='pixel-editor__tool-glyph' aria-hidden='true'>{item.glyph}</span>
                )}
                <span className={item.icon ? 'pixel-editor__tool-label--hidden' : ''}>{item.label}</span>
              </button>
            )
          })}
        </div>
        <div className='pixel-editor__tool-group'>
          <button
            className='pixel-editor__tool'
            type='button'
            disabled={undoStack.length === 0}
            onClick={undo}
          >
            <img src={undoStack.length ? undoActiveIcon : undoIcon} alt='' />
            <span className='pixel-editor__tool-label--hidden'>撤销</span>
          </button>
          <button
            className='pixel-editor__tool'
            type='button'
            disabled={redoStack.length === 0}
            onClick={redo}
          >
            <img src={redoStack.length ? redoActiveIcon : redoIcon} alt='' />
            <span className='pixel-editor__tool-label--hidden'>重做</span>
          </button>
          <button className='pixel-editor__tool pixel-editor__tool--danger' type='button' onClick={clearCanvas}>
            <span className='pixel-editor__tool-layered-icon' aria-hidden='true'>
              <img src={clearIcon} alt='' />
              <img className='is-active' src={clearActiveIcon} alt='' />
            </span>
            <span className='pixel-editor__tool-label--hidden'>清空</span>
          </button>
          <button
            className={`pixel-editor__tool ${showCodes ? 'pixel-editor__tool--active' : ''}`}
            type='button'
            aria-pressed={showCodes}
            onClick={() => setShowCodes((value) => !value)}
          >
            <img src={showCodes ? numbersActiveIcon : numbersIcon} alt='' />
            <span className='pixel-editor__tool-label--hidden'>色号</span>
          </button>
          <button className='pixel-editor__tool' type='button' onClick={mirrorCanvas}>
            <span className='pixel-editor__tool-glyph' aria-hidden='true'>↔</span>
            <span>镜像</span>
          </button>
          <button
            className='pixel-editor__tool'
            type='button'
            disabled={workingMatrix.length !== (workingMatrix[0]?.length ?? 0)}
            title={
              workingMatrix.length === (workingMatrix[0]?.length ?? 0)
                ? '顺时针旋转 90°'
                : '矩形钉板为保持尺寸暂不支持 90° 旋转'
            }
            onClick={rotateCanvas}
          >
            <span className='pixel-editor__tool-glyph' aria-hidden='true'>↻</span>
            <span>旋转</span>
          </button>
        </div>
        <div className='pixel-editor__zoom' aria-label='画布缩放'>
          <button
            className='pixel-editor__zoom-button'
            type='button'
            aria-label='缩小画布'
            onClick={() => setZoom((value) => Math.max(0.4, value - 0.25))}
          >
            −
          </button>
          <button className='pixel-editor__zoom-button' type='button' title='恢复 100%' onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className='pixel-editor__zoom-button' type='button' onClick={fitCanvasToViewport}>
            适配
          </button>
          <button
            className='pixel-editor__zoom-button'
            type='button'
            aria-label='放大画布'
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            +
          </button>
        </div>
      </div>

      <div ref={viewportRef} className='pixel-editor__viewport'>
        <canvas
          ref={canvasRef}
          className={`pixel-editor__canvas ${
            tool === 'pan' ? 'pixel-editor__canvas--pan' : ''
          }`}
          aria-label={`${boardLabel} 像素画布`}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            if (
              tool === 'pan' &&
              panStartRef.current &&
              activePointerIdRef.current === event.pointerId
            ) {
              event.preventDefault()
              const viewport = viewportRef.current
              if (viewport) {
                viewport.scrollLeft =
                  panStartRef.current.scrollLeft -
                  (event.clientX - panStartRef.current.clientX)
                viewport.scrollTop =
                  panStartRef.current.scrollTop -
                  (event.clientY - panStartRef.current.clientY)
              }
              return
            }
            if (
              drawingRef.current &&
              activePointerIdRef.current === event.pointerId
            ) {
              event.preventDefault()
              if (tool === 'select') selectAtPointer(event)
              else paintAtPointer(event)
            }
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onLostPointerCapture={finishStroke}
          style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
        />
      </div>

      <section className='pixel-editor__correction' aria-label='色号校对'>
        <div className='pixel-editor__correction-heading'>
          <div>
            <strong>色号校对</strong>
            <small>选中格子后，可批量改色或删除；下方色板用于选择替换色号。</small>
          </div>
          <span>已选 {selectedCells.size}</span>
        </div>
        <div className='pixel-editor__correction-actions'>
          <button type='button' onClick={selectAllPlacedCells}>全选非空</button>
          <button type='button' onClick={invertPlacedSelection}>反选</button>
          <button type='button' disabled={selectedCells.size === 0} onClick={() => setSelectedCells(new Set())}>取消选择</button>
          <button type='button' disabled={selectedCells.size === 0 || !selectedCode} onClick={() => updateSelectedCells(selectedCode || null)}>改为 {selectedCode || '所选色号'}</button>
          <button className='is-danger' type='button' disabled={selectedCells.size === 0} onClick={() => updateSelectedCells(null)}>删除</button>
        </div>
      </section>

      <div className='pixel-editor__palette-panel'>
        <div className='pixel-editor__palette-heading'>
          <div>
            <div className='pixel-editor__palette-title'>画笔颜色</div>
            <div className='pixel-editor__palette-hint'>选择拼豆色号；切换方案后可一键重新匹配。</div>
          </div>
          <div className='pixel-editor__palette-actions'>
            <select
              aria-label='选择拼豆配色方案'
              value={selectedPreset}
              onChange={(event) => setSelectedPreset(event.target.value)}
            >
              {Object.entries(presets).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
            <button type='button' onClick={applySelectedPalette}>
              一键套用
            </button>
          </div>
        </div>
        <div className='pixel-editor__swatches' role='list' aria-label='可用拼豆颜色'>
          {presetColors.map((color) => (
            <button
              key={color.code}
              className={`pixel-editor__swatch ${selectedCode === color.code ? 'pixel-editor__swatch--active' : ''}`}
              type='button'
              role='listitem'
              title={`${color.code} ${color.name_zh || color.name}`}
              aria-label={`选择颜色 ${color.code}`}
              aria-pressed={selectedCode === color.code}
              onClick={() => {
                setSelectedCode(color.code)
                if (selectedCells.size === 0) setTool('pen')
              }}
            >
              <span style={{ backgroundColor: color.hex }} />
              <small>{color.code}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
