import type { CSSProperties, MouseEvent, RefObject, TouchEvent } from 'react'
import { getCalibrationGridBackgroundSize } from '@/features/image-calibration/model'
import './index.h5.scss'

export interface CropDialogH5Props {
  open: boolean
  imageUrl: string
  cropImageRef: RefObject<HTMLImageElement | null>
  cropImageStyle: CSSProperties
  cropBoxStyle: CSSProperties
  boardLabel: string
  gridWidth: number
  gridHeight: number
  zoom: number
  onCancel: () => void
  onConfirm: () => void
  onReset: () => void
  onZoomChange: (zoom: number) => void
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
}

export function CropDialogH5({
  open,
  imageUrl,
  cropImageRef,
  cropImageStyle,
  cropBoxStyle,
  boardLabel,
  gridWidth,
  gridHeight,
  zoom,
  onCancel,
  onConfirm,
  onReset,
  onZoomChange,
  onMouseDown,
  onTouchStart
}: CropDialogH5Props) {
  const calibrationGridStyle: CSSProperties = {
    ...cropBoxStyle,
    backgroundSize: getCalibrationGridBackgroundSize(gridWidth, gridHeight)
  }

  return (
    <div
      id='crop-dialog'
      className='modal modal-crop'
      style={{ display: open ? 'flex' : 'none' }}
    >
      <div className='modal-content modal-content-crop'>
        <div className='modal-header'>
          <div>
            <h3>网格校准</h3>
            <p className='crop-dialog__subtitle'>
              目标钉板 {boardLabel}（{gridWidth} 列 × {gridHeight} 行），拖动网格调整位置。
            </p>
          </div>
          <button className='modal-close' onClick={onCancel} type='button'>
            &times;
          </button>
        </div>
        <div className='crop-dialog__controls'>
          <label htmlFor='crop-zoom'>图片缩放</label>
          <button
            aria-label='缩小校准图片'
            disabled={zoom <= 1}
            type='button'
            onClick={() => onZoomChange(zoom - 0.1)}
          >
            −
          </button>
          <input
            id='crop-zoom'
            type='range'
            min='1'
            max='3'
            step='0.05'
            value={zoom}
            onChange={(event) => onZoomChange(Number.parseFloat(event.target.value))}
          />
          <button
            aria-label='放大校准图片'
            disabled={zoom >= 3}
            type='button'
            onClick={() => onZoomChange(zoom + 0.1)}
          >
            +
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type='button' onClick={onReset}>
            复位
          </button>
        </div>
        <div className='modal-body modal-body-crop'>
          <div id='crop-container' className='crop-surface'>
            <img
              id='crop-image'
              ref={cropImageRef}
              src={imageUrl}
              className='crop-image'
              style={cropImageStyle}
            />
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
        <div className='modal-footer modal-footer-split crop-actions'>
          <button
            className='btn btn-secondary'
            onClick={onCancel}
            style={{ flex: 1, borderRadius: 0 }}
            type='button'
          >
            取消
          </button>
          <button
            className='btn btn-primary'
            onClick={onConfirm}
            style={{ flex: 1, borderRadius: 0 }}
            type='button'
          >
            智能像素化并生成
          </button>
        </div>
      </div>
    </div>
  )
}
