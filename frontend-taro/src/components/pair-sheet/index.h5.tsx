import type { BleKnownDevice } from '@/adapters/ble/types'
import './index.h5.scss'

export interface PairSheetBleOption extends BleKnownDevice {
  meta: string
  connected: boolean
  remembered: boolean
  requiresPairing?: boolean
}

export interface PairSheetH5Props {
  open: boolean
  statusMessage: string
  statusTone: 'default' | 'ready' | 'connected'
  bleAvailable: boolean
  devices: PairSheetBleOption[]
  onClose: () => void
  onSelectDevice: (deviceKey: string) => void
  onAddDevice: () => void
}

export function PairSheetH5({
  open,
  statusMessage,
  statusTone,
  bleAvailable,
  devices,
  onClose,
  onSelectDevice,
  onAddDevice
}: PairSheetH5Props) {
  const secureContext =
    typeof window === 'undefined' ||
    window.isSecureContext ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  const hasAuthorizedDevice = devices.length > 0
  const hasConnectedDevice = devices.some((device) => device.connected)

  return (
    <div
      id='ble-pair-dialog'
      className='modal'
      style={{ display: open ? 'flex' : 'none' }}
    >
      <div className='modal-content modal-content-form qr-modal-content'>
        <div className='modal-header'>
          <h3>蓝牙连接</h3>
          <button className='modal-close' onClick={onClose} type='button'>
            &times;
          </button>
        </div>
        <div className='modal-body'>
          <div id='ble-settings' className='connection-settings'>
            <div
              id='ble-status-card'
              className={`ble-status-card${statusTone === 'ready' ? ' ready' : ''}${statusTone === 'connected' ? ' connected' : ''}`}
            >
              {statusMessage}
            </div>
            <div className='form-group'>
              <label className='form-label'>蓝牙设备：</label>
              <div
                id='ble-device-list'
                className='ble-device-list'
                role='radiogroup'
                aria-label='已授权蓝牙设备'
              >
                {!bleAvailable ? (
                  <div className='ble-device-empty'>{statusMessage}</div>
                ) : devices.length === 0 ? (
                  <div className='ble-device-empty'>
                    还没有已授权的拼豆板设备，点“添加设备”进行首次连接。
                  </div>
                ) : (
                  devices.map((device) => (
                    <button
                      key={device.key}
                      type='button'
                      className={`ble-device-option${device.connected ? ' connected' : ''}${device.remembered ? ' remembered' : ''}`}
                      role='radio'
                      aria-checked={device.connected ? 'true' : 'false'}
                      data-device-key={device.key}
                      onClick={() => onSelectDevice(device.key)}
                    >
                      <span className='ble-device-radio' />
                      <span className='ble-device-info'>
                        <span className='ble-device-title'>{device.name || device.uuid || '拼豆板'}</span>
                        <span className='ble-device-meta'>{device.meta}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                id='ble-add-device-btn'
                className='btn btn-primary btn-small ble-add-device-btn'
                onClick={onAddDevice}
                type='button'
                disabled={!bleAvailable}
              >
                添加设备
              </button>
            </div>
            <div className='ble-diagnostics' aria-label='蓝牙连接诊断'>
              <strong>连接诊断</strong>
              <span className={secureContext ? 'is-ok' : 'is-error'}>
                {secureContext ? '✓' : '×'} HTTPS 或 localhost 安全环境
              </span>
              <span className={bleAvailable ? 'is-ok' : 'is-error'}>
                {bleAvailable ? '✓' : '×'} 浏览器蓝牙能力
              </span>
              <span className={hasAuthorizedDevice ? 'is-ok' : 'is-pending'}>
                {hasAuthorizedDevice ? '✓' : '·'} 已授权设备
              </span>
              <span className={hasConnectedDevice ? 'is-ok' : 'is-pending'}>
                {hasConnectedDevice ? '✓' : '·'} 当前 GATT 连接
              </span>
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
