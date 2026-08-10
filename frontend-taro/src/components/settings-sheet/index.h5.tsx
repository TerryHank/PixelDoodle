import type { ExportKind } from '@/services/pattern-service'
import './index.h5.scss'

export interface SettingsSheetH5Props {
  open: boolean
  onClose: () => void
  onExport: (kind: ExportKind) => void
}

export function SettingsSheetH5({
  open,
  onClose,
  onExport
}: SettingsSheetH5Props) {
  return (
    <div
      id='serial-settings-dialog'
      className='modal'
      style={{ display: open ? 'flex' : 'none' }}
    >
      <div className='modal-content modal-content-form qr-modal-content'>
        <div className='modal-header'>
          <h3>导出</h3>
          <button className='modal-close' onClick={onClose} type='button'>
            &times;
          </button>
        </div>
        <div className='modal-body'>
          <div className='form-group'>
            <label className='form-label'>选择格式：</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button className='btn btn-secondary' onClick={() => onExport('png')} type='button'>
                导出PNG
              </button>
              <button className='btn btn-secondary' onClick={() => onExport('pdf')} type='button'>
                导出PDF
              </button>
              <button className='btn btn-secondary' onClick={() => onExport('json')} type='button'>
                导出JSON
              </button>
            </div>
          </div>
        </div>
        <div className='modal-footer'>
          <button className='btn btn-primary' onClick={onClose} type='button'>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
