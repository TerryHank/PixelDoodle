import { Text, View } from '@tarojs/components'
import type { BleKnownDevice } from '@/adapters/ble/types'
import './index.scss'

export interface PairSheetBleOption extends BleKnownDevice {
  meta: string
  connected: boolean
  remembered: boolean
}

export interface PairSheetProps {
  visible: boolean
  bleAvailable: boolean
  bleConnectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  statusMessage: string
  statusTone: 'default' | 'ready' | 'connected'
  devices: PairSheetBleOption[]
  isScanning: boolean
  onClose: () => void
  onSelectDevice: (deviceKey: string) => void
  onAddDevice: () => void
}

export function PairSheet({
  visible,
  bleAvailable,
  bleConnectionStatus,
  statusMessage,
  statusTone,
  devices,
  isScanning,
  onClose,
  onSelectDevice,
  onAddDevice
}: PairSheetProps) {
  if (!visible) {
    return null
  }

  const addButtonLabel = isScanning ? '搜索中...' : devices.length > 0 ? '重新扫描' : '添加设备'
  const addButtonClassName = `ble-add-device-btn${isScanning || bleConnectionStatus === 'connecting' ? ' ble-add-device-btn--disabled' : ''}`

  return (
    <View className='pair-sheet'>
      <View className='pair-sheet__mask' onClick={onClose} />
      <View className='pair-sheet__panel'>
        <View className='pair-sheet__header'>
          <View>
            <Text className='pair-sheet__title'>蓝牙连接</Text>
            <Text className='pair-sheet__subtitle'>连接当前 BeadCraft 设备，用于发送图案与同步高亮</Text>
          </View>
          <View className='pair-sheet__close' onClick={onClose}>
            <Text>×</Text>
          </View>
        </View>

        <View className='pair-sheet__body'>
          <View
            className={`ble-status-card${statusTone === 'ready' ? ' ready' : ''}${statusTone === 'connected' ? ' connected' : ''}`}
          >
            <Text>{statusMessage}</Text>
          </View>

          <View className='pair-sheet__group'>
            <Text className='pair-sheet__label'>蓝牙设备：</Text>
            <View className='ble-device-list'>
              {!bleAvailable ? (
                <View className='ble-device-empty'>
                  <Text>当前小程序环境不支持蓝牙连接</Text>
                </View>
              ) : devices.length === 0 ? (
                <View className='ble-device-empty'>
                  <Text>{isScanning ? '正在搜索附近的 BeadCraft 设备...' : '还没有发现附近的 BeadCraft 设备，点“添加设备”开始搜索。'}</Text>
                </View>
              ) : (
                devices.map((device) => (
                  <View
                    key={device.key}
                    className={`ble-device-option${device.connected ? ' connected' : ''}${device.remembered ? ' remembered' : ''}`}
                    onClick={() => onSelectDevice(device.key)}
                  >
                    <View className='ble-device-radio' />
                    <View className='ble-device-info'>
                      <Text className='ble-device-title'>{device.uuid || device.name || 'BeadCraft'}</Text>
                      <Text className='ble-device-meta'>{device.meta}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
            <View className={addButtonClassName} onClick={isScanning ? undefined : onAddDevice}>
              <Text>{addButtonLabel}</Text>
            </View>
          </View>
        </View>

        <View className='pair-sheet__footer'>
          <View className='pair-sheet__footer-button pair-sheet__footer-button--primary' onClick={onClose}>
            <Text>关闭</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
