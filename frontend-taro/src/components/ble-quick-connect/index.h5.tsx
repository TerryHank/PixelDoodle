import './index.h5.scss'

export interface BleQuickConnectH5Props {
  open: boolean
  text: string
  onCancel: () => void
  onConfirm: () => void
}

export function BleQuickConnectH5({
  open,
  text,
  onCancel,
  onConfirm
}: BleQuickConnectH5Props) {
  return (
    <div
      id='ble-quick-connect'
      className='ble-quick-connect'
      style={{ display: open ? 'block' : 'none' }}
    >
      <div className='ble-quick-connect-card'>
        <div className='ble-quick-connect-title'>连接这台设备</div>
        <div id='ble-quick-connect-text' className='ble-quick-connect-text'>
          {text}
        </div>
        <div className='ble-quick-connect-actions'>
          <button className='btn btn-secondary' onClick={onCancel} type='button'>
            稍后
          </button>
          <button className='btn btn-primary' onClick={onConfirm} type='button'>
            连接设备
          </button>
        </div>
      </div>
    </div>
  )
}
