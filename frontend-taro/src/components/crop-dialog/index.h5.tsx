import type { CSSProperties, MouseEvent, RefObject, TouchEvent } from 'react'
import './index.h5.scss'

export interface CropDialogH5Props {
  open: boolean
  imageUrl: string
  cropImageRef: RefObject<HTMLImageElement | null>
  cropImageStyle: CSSProperties
  cropBoxStyle: CSSProperties
  onCancel: () => void
  onConfirm: () => void
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
}

export function CropDialogH5({
  open,
  imageUrl,
  cropImageRef,
  cropImageStyle,
  cropBoxStyle,
  onCancel,
  onConfirm,
  onMouseDown,
  onTouchStart
}: CropDialogH5Props) {
  return (
    <div
      id='crop-dialog'
      className='modal modal-crop'
      style={{ display: open ? 'flex' : 'none' }}
    >
      <div className='modal-content modal-content-crop'>
        <div className='modal-header'>
          <h3>裁剪图像</h3>
          <button className='modal-close' onClick={onCancel} type='button'>
            &times;
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
              onMouseDown={onMouseDown}
              onTouchStart={onTouchStart}
              style={cropBoxStyle}
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
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  )
}
