import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { PaletteColor, PalettePresetMap, PixelMatrix } from '@/types/api'
import {
  applyPaletteToPixelMatrix,
  clonePixelMatrix,
  createEmptyPixelMatrix,
  floodFillPixelMatrix,
  getPresetColors,
  matricesEqual,
  setPixelCell
} from './model'
import './index.h5.scss'

type EditorTool = 'pen' | 'eraser' | 'fill'

const HISTORY_LIMIT = 40

export interface PixelEditorH5Props {
  matrix: PixelMatrix
  colors: PaletteColor[]
  presets: PalettePresetMap
  palettePreset: string
  boardLabel: string
  onChange: (matrix: PixelMatrix) => void
  onPalettePresetChange: (preset: string) => void
  onSave: () => void
  onCloudSave?: () => void
  isCloudSaving?: boolean
  cloudSaved?: boolean
}

function getCellSize(matrix: PixelMatrix, zoom: number) {
  const maxDimension = Math.max(matrix.length, matrix[0]?.length ?? 1)
  const baseSize = Math.max(4, Math.min(12, Math.floor(520 / maxDimension)))
  return Math.max(3, Math.round(baseSize * zoom))
}

export function PixelEditorH5({
  matrix,
  colors,
  presets,
  palettePreset,
  boardLabel,
  onChange,
  onPalettePresetChange,
  onSave,
  onCloudSave,
  isCloudSaving = false,
  cloudSaved = false
}: PixelEditorH5Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const workingMatrixRef = useRef<PixelMatrix>(clonePixelMatrix(matrix))
  const strokeStartRef = useRef<PixelMatrix | null>(null)
  const drawingRef = useRef(false)
  const lastCellRef = useRef('')
  const [workingMatrix, setWorkingMatrix] = useState(() => clonePixelMatrix(matrix))
  const [undoStack, setUndoStack] = useState<PixelMatrix[]>([])
  const [redoStack, setRedoStack] = useState<PixelMatrix[]>([])
  const [tool, setTool] = useState<EditorTool>('pen')
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedPreset, setSelectedPreset] = useState(palettePreset)
  const [zoom, setZoom] = useState(1)

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
  }, [canvasHeight, canvasWidth, cellSize, colorLookup, workingMatrix])

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

    const cellKey = `${cell.x}:${cell.y}`
    if (lastCellRef.current === cellKey) {
      return
    }
    lastCellRef.current = cellKey

    const code = tool === 'eraser' ? null : selectedCode || null
    const current = workingMatrixRef.current
    const next = setPixelCell(current, cell.x, cell.y, code)
    if (next === current) {
      return
    }

    workingMatrixRef.current = next
    setWorkingMatrix(next)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = resolvePointerCell(event)
    if (!cell) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    lastCellRef.current = ''

    if (tool === 'fill') {
      const previous = workingMatrixRef.current
      const next = floodFillPixelMatrix(previous, cell.x, cell.y, selectedCode || null)
      recordChange(previous, next)
      return
    }

    drawingRef.current = true
    strokeStartRef.current = clonePixelMatrix(workingMatrixRef.current)
    paintAtPointer(event)
  }

  function finishStroke() {
    if (!drawingRef.current) {
      return
    }

    drawingRef.current = false
    lastCellRef.current = ''
    const previous = strokeStartRef.current
    strokeStartRef.current = null
    if (!previous) {
      return
    }

    recordChange(previous, workingMatrixRef.current)
  }

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

  return (
    <section className='pixel-editor' aria-label='拼豆像素编辑器'>
      <div className='pixel-editor__header'>
        <div>
          <div className='pixel-editor__eyebrow'>创作画布</div>
          <h2 className='pixel-editor__title'>{boardLabel} 钉板</h2>
          <p className='pixel-editor__subtitle'>点击或拖动涂色，支持撤销、填充和缩放查看。</p>
        </div>
        <div className='pixel-editor__save-group'>
          <span className='pixel-editor__local-status'>
            {cloudSaved ? '本机 + 私有云已保存' : '当前仅保存在本机'}
          </span>
          <button className='pixel-editor__save-button' type='button' onClick={onSave}>
            保存到本机
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
          {([
            ['pen', '画笔'],
            ['eraser', '橡皮'],
            ['fill', '填充']
          ] as Array<[EditorTool, string]>).map(([value, label]) => (
            <button
              key={value}
              className={`pixel-editor__tool ${tool === value ? 'pixel-editor__tool--active' : ''}`}
              type='button'
              aria-pressed={tool === value}
              onClick={() => setTool(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className='pixel-editor__tool-group'>
          <button
            className='pixel-editor__tool'
            type='button'
            disabled={undoStack.length === 0}
            onClick={undo}
          >
            撤销
          </button>
          <button
            className='pixel-editor__tool'
            type='button'
            disabled={redoStack.length === 0}
            onClick={redo}
          >
            重做
          </button>
          <button className='pixel-editor__tool pixel-editor__tool--danger' type='button' onClick={clearCanvas}>
            清空
          </button>
        </div>
        <div className='pixel-editor__zoom' aria-label='画布缩放'>
          <button
            type='button'
            aria-label='缩小画布'
            onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
          >
            −
          </button>
          <button type='button' title='恢复 100%' onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            type='button'
            aria-label='放大画布'
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            +
          </button>
        </div>
      </div>

      <div className='pixel-editor__viewport'>
        <canvas
          ref={canvasRef}
          className='pixel-editor__canvas'
          aria-label={`${boardLabel} 像素画布`}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            if (drawingRef.current) {
              event.preventDefault()
              paintAtPointer(event)
            }
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
        />
      </div>

      <div className='pixel-editor__palette-panel'>
        <div className='pixel-editor__palette-heading'>
          <div>
            <div className='pixel-editor__palette-title'>专业拼豆配色</div>
            <div className='pixel-editor__palette-hint'>切换方案后点击“一键套用”，已有颜色会自动匹配。</div>
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
                setTool('pen')
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
