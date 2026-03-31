import { Text, View } from '@tarojs/components'
import type { ConnectionMode, RegisteredWifiDevice } from '@/types/device'
import type { ExportKind } from '@/services/pattern-service'
import './index.scss'

export interface SettingsSheetProps {
  visible: boolean
  connectionMode: ConnectionMode
  targetDeviceUuid?: string
  registeredWifiDevice: RegisteredWifiDevice | null
  isSending: boolean
  onClose: () => void
  onChangeMode: (mode: ConnectionMode) => void
  onSend: () => void
  onExport: (kind: ExportKind) => void
}

export function SettingsSheet({
  visible,
  connectionMode,
  targetDeviceUuid,
  registeredWifiDevice,
  isSending,
  onClose,
  onChangeMode,
  onSend,
  onExport
}: SettingsSheetProps) {
  const isRnRuntime = process.env.TARO_ENV === 'rn'

  if (!visible) {
    return null
  }

  return (
    <View className='settings-sheet'>
      <View className='settings-sheet__mask' onClick={onClose} />
      <View className='settings-sheet__panel'>
        <View className='settings-sheet__header'>
          <View>
            <Text className='settings-sheet__title'>发送与导出</Text>
            <Text className='settings-sheet__subtitle'>
              仅保留蓝牙 / WiFi 模式和发送、导出四个动作
            </Text>
          </View>
          <View className='settings-sheet__close' onClick={onClose}>
            <Text>关闭</Text>
          </View>
        </View>

        <View className='settings-sheet__body'>
          <View className='settings-sheet__mode-switch'>
            <View
              className={`settings-sheet__mode-pill ${connectionMode === 'ble' ? 'settings-sheet__mode-pill--active' : ''}`}
              onClick={() => onChangeMode('ble')}
            >
              <Text>蓝牙</Text>
            </View>
            <View
              className={`settings-sheet__mode-pill ${connectionMode === 'wifi' ? 'settings-sheet__mode-pill--active' : ''}`}
              onClick={() => onChangeMode('wifi')}
            >
              <Text>WiFi</Text>
            </View>
          </View>

          <View className='settings-sheet__summary'>
            <Text className='settings-sheet__summary-line'>
              目标设备：{targetDeviceUuid || '未锁定'}
            </Text>
            <Text className='settings-sheet__summary-line'>
              WiFi 中继：{registeredWifiDevice?.ip || '未注册'}
            </Text>
            <Text className='settings-sheet__summary-hint'>
              切换到 WiFi 后，请通过顶部“扫”按钮完成热点扫描和配网。
            </Text>
            {isRnRuntime ? (
              <Text className='settings-sheet__summary-hint'>
                RN Android 端当前未接通导出文件保存，点击导出会提示失败原因。
              </Text>
            ) : null}
          </View>

          <View
            className={`settings-sheet__action settings-sheet__action--primary ${isSending ? 'settings-sheet__action--disabled' : ''}`}
            onClick={onSend}
          >
            <Text>{isSending ? '发送中...' : '发送到 ESP32'}</Text>
          </View>

          <View className='settings-sheet__action-grid'>
            <View className='settings-sheet__action settings-sheet__action--ghost' onClick={() => onExport('png')}>
              <Text>导出 PNG</Text>
            </View>
            <View className='settings-sheet__action settings-sheet__action--ghost' onClick={() => onExport('pdf')}>
              <Text>导出 PDF</Text>
            </View>
            <View className='settings-sheet__action settings-sheet__action--ghost' onClick={() => onExport('json')}>
              <Text>导出 JSON</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
