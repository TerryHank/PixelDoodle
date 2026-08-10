import './index.h5.scss'

export interface CanvasPanelProps {
  showUploadGuide: boolean
  showDeviceChip?: boolean
  targetDeviceUuid?: string
  previewImage?: string | null
}

export function CanvasPanel({
  showUploadGuide,
  showDeviceChip = false,
  targetDeviceUuid,
  previewImage
}: CanvasPanelProps) {
  return (
    <div className='canvas-container' style={{ margin: '0 auto', position: 'relative' }}>
      {showUploadGuide ? (
        <div className='upload-area scan-guide'>
          <div className='upload-area-icon'>QR</div>
          <div className='upload-area-text'>先扫描设备二维码进行配对</div>
          <div className='upload-area-hint'>
            已配对后可继续上传图片；也可在设置中切换 WiFi 模式
          </div>
          {showDeviceChip && targetDeviceUuid ? (
            <div className='canvas-panel__device-chip'>已锁定设备 {targetDeviceUuid}</div>
          ) : null}
        </div>
      ) : previewImage ? (
        <div className='preview-section'>
          <img alt='preview' className='preview-image' src={previewImage} />
        </div>
      ) : (
        <div className='upload-area'>
          <div className='upload-area-text'>请上传图片或选择示例图</div>
        </div>
      )}
    </div>
  )
}
