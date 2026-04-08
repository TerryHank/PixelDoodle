import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, Image, Text, View } from '@tarojs/components'
import type { UploadAreaMode } from '@/pages/home/view-model'
import { useDeviceStore } from '@/store/device-store'
import type { PixelMatrix } from '@/types/api'
import {
  buildCanvasRenderModel,
  drawCanvasRenderModel
} from '@/utils/pattern-render'
import { getRuntimeEnv } from '@/utils/runtime-env'
import './index.scss'

export interface CanvasPanelProps {
  showUploadGuide: boolean
  uploadAreaMode: UploadAreaMode
  uploadAreaClassName: string
  uploadAreaIcon: string
  uploadAreaText: string
  uploadAreaHint: string
  previewImage?: string | null
  pixelMatrix?: PixelMatrix
  colorLookup?: Record<string, string>
  activeCodes?: string[]
  onUploadAreaClick?: () => void
}

const SHARED_CANVAS_ID = 'pattern-canvas-shared'

function resolveMaxPatternDim() {
  try {
    const windowInfo =
      typeof Taro.getWindowInfo === 'function'
        ? Taro.getWindowInfo()
        : Taro.getSystemInfoSync()
    const windowWidth = Number(windowInfo.windowWidth || 0)

    if (windowWidth > 0) {
      return Math.max(160, Math.min(640, Math.floor(windowWidth - 28)))
    }
  } catch {}

  return 640
}

export function CanvasPanel({
  showUploadGuide,
  uploadAreaMode,
  uploadAreaClassName,
  uploadAreaIcon,
  uploadAreaText,
  uploadAreaHint,
  previewImage,
  pixelMatrix = [],
  colorLookup = {},
  activeCodes,
  onUploadAreaClick
}: CanvasPanelProps) {
  const currentEnv = getRuntimeEnv()
  const drawTicketRef = useRef(0)
  const canvasNodeRef = useRef<
    | (HTMLCanvasElement & {
        width: number
        height: number
        getContext: (kind: '2d') => CanvasRenderingContext2D | null
      })
    | null
  >(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const activeHighlightCodes = useDeviceStore((state) => state.activeHighlightCodes)
  const resolvedActiveCodes = activeCodes ?? activeHighlightCodes
  const hasPattern = pixelMatrix.some((row) => row.length > 0)
  const gridWidth = pixelMatrix[0]?.length || 0
  const gridHeight = pixelMatrix.length

  const renderModel = useMemo(
    () =>
      hasPattern && gridWidth > 0 && gridHeight > 0
        ? buildCanvasRenderModel({
            gridWidth,
            gridHeight,
            pixelMatrix,
            activeCodes: new Set(resolvedActiveCodes),
            maxPatternDim: resolveMaxPatternDim()
          })
        : null,
    [gridHeight, gridWidth, hasPattern, pixelMatrix, resolvedActiveCodes]
  )

  const isWeappCanvasMode = currentEnv === 'weapp' && renderModel !== null

  useEffect(() => {
    if (!isWeappCanvasMode || !renderModel) {
      canvasNodeRef.current = null
      canvasContextRef.current = null
      return
    }

    const drawTicket = drawTicketRef.current + 1
    drawTicketRef.current = drawTicket

    const drawIntoCanvas = () => {
      const canvasNode = canvasNodeRef.current
      const context = canvasContextRef.current
      if (!canvasNode || !context) {
        return false
      }

      const windowInfo =
        typeof Taro.getWindowInfo === 'function'
          ? Taro.getWindowInfo()
          : Taro.getSystemInfoSync()
      const dpr = Math.max(1, Number(windowInfo.pixelRatio || 1))

      canvasNode.width = Math.max(1, Math.floor(renderModel.canvasWidth * dpr))
      canvasNode.height = Math.max(1, Math.floor(renderModel.canvasHeight * dpr))

      if (typeof context.setTransform === 'function') {
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
      } else if (typeof context.scale === 'function') {
        context.scale(dpr, dpr)
      }

      drawCanvasRenderModel({
        context,
        model: renderModel,
        colorLookup
      })

      return true
    }

    if (drawIntoCanvas()) {
      return
    }

    Taro.nextTick(() => {
      if (drawTicketRef.current !== drawTicket) {
        return
      }

      Taro.createSelectorQuery()
        .select(`#${SHARED_CANVAS_ID}`)
        .fields({ node: true, size: true } as never)
        .exec((result) => {
          if (drawTicketRef.current !== drawTicket) {
            return
          }

          const canvasNode = result?.[0]?.node as
            | (HTMLCanvasElement & {
                width: number
                height: number
                getContext: (kind: '2d') => CanvasRenderingContext2D | null
              })
            | undefined

          if (!canvasNode) {
            return
          }

          const context = canvasNode.getContext('2d')
          if (!context) {
            return
          }

          canvasNodeRef.current = canvasNode
          canvasContextRef.current = context
          drawIntoCanvas()
        })
    })
  }, [colorLookup, isWeappCanvasMode, renderModel])

  return (
    <View className='canvas-container'>
      {showUploadGuide ? (
        <View className={uploadAreaClassName} onClick={onUploadAreaClick}>
          <Text
            className={`upload-area-icon ${
              uploadAreaMode === 'upload' ? 'upload-area-icon--plus' : ''
            }`}
          >
            {uploadAreaIcon}
          </Text>
          <Text className='upload-area-text'>{uploadAreaText}</Text>
          <Text className='upload-area-hint'>{uploadAreaHint}</Text>
        </View>
      ) : isWeappCanvasMode && renderModel ? (
        <View className='preview-section'>
          <Canvas
            id={SHARED_CANVAS_ID}
            type='2d'
            className='pattern-canvas'
            style={{
              width: `${renderModel.canvasWidth}px`,
              height: `${renderModel.canvasHeight}px`
            }}
          />
        </View>
      ) : renderModel ? (
        <View className='preview-section'>
          <View
            className='pattern-grid'
            style={{
              width: `${renderModel.canvasWidth}px`,
              height: `${renderModel.canvasHeight}px`
            }}
          >
            {renderModel.cells.map((cell) => {
              const cellStyle = {
                left: `${cell.x * renderModel.cellSize}px`,
                top: `${cell.y * renderModel.cellSize}px`,
                width: `${renderModel.cellSize}px`,
                height: `${renderModel.cellSize}px`,
                backgroundColor:
                  cell.code === null
                    ? 'transparent'
                    : (colorLookup[cell.code] || '#FFFFFF'),
                borderWidth: renderModel.cellSize >= 4 ? '1px' : '0px'
              }

              return (
                <View
                  key={`${cell.x}-${cell.y}`}
                  className={`pattern-cell ${
                    cell.code === null ? 'pattern-cell--transparent' : ''
                  }`}
                  style={cellStyle}
                >
                  {cell.masked ? <View className='pattern-cell__mask' /> : null}
                </View>
              )
            })}
          </View>
        </View>
      ) : previewImage ? (
        <View className='preview-section'>
          <Image
            className='preview-image'
            mode='aspectFit'
            src={previewImage}
          />
        </View>
      ) : (
        <View className='upload-area' onClick={onUploadAreaClick}>
          <Text className='upload-area-text'>请上传图片或选择示例图</Text>
        </View>
      )}
    </View>
  )
}
