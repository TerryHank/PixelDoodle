import { Input, Text, View } from '@tarojs/components'
import { getRuntimeEnv } from '@/utils/runtime-env'
import type {
  ConnectionMode,
  DeviceConnectionStatus,
  RegisteredWifiDevice,
  WifiScanResult
} from '@/types/device'
import './index.scss'

export interface PairSheetProps {
  visible: boolean
  mode: ConnectionMode
  manualUuid: string
  targetDeviceUuid?: string
  bleConnectionStatus: DeviceConnectionStatus
  wifiScanResults: WifiScanResult[]
  selectedWifiHotspot: WifiScanResult | null
  wifiPassword: string
  registeredWifiDevice: RegisteredWifiDevice | null
  onClose: () => void
  onModeChange: (mode: ConnectionMode) => void
  onScan: () => void
  onConnect: () => void
  onManualUuidChange: (value: string) => void
  onScanWifi: () => void
  onSelectWifiHotspot: (hotspot: WifiScanResult) => void
  onWifiPasswordChange: (value: string) => void
  onConnectWifi: () => void
}

function getStatusLabel(status: DeviceConnectionStatus) {
  if (status === 'connecting') return '连接中'
  if (status === 'connected') return '已连接'
  if (status === 'error') return '连接失败'
  return '待连接'
}

export function PairSheet({
  visible,
  manualUuid,
  targetDeviceUuid,
  bleConnectionStatus,
  onClose,
  onConnect,
  onManualUuidChange,
}: PairSheetProps) {
  const isRnRuntime = getRuntimeEnv() === 'rn'

  if (!visible) {
    return null
  }

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

        <View className='pair-sheet__status'>
          <Text className='pair-sheet__status-label'>状态</Text>
          <Text className='pair-sheet__status-value'>{getStatusLabel(bleConnectionStatus)}</Text>
        </View>

        <View className='pair-sheet__body'>
          <View className='pair-sheet__scan-button' onClick={onConnect}>
            <Text className='pair-sheet__scan-label'>连接设备</Text>
            <Text className='pair-sheet__scan-hint'>
              {targetDeviceUuid
                ? `当前目标：${targetDeviceUuid}`
                : '未连接时也可以先生成图片，连接后才会发送到设备'}
            </Text>
          </View>

          {isRnRuntime ? (
            <View className='pair-sheet__group'>
              <Text className='pair-sheet__hint'>RN Android 端当前请优先手动输入 UUID 后连接。</Text>
            </View>
          ) : null}

          <View className='pair-sheet__group'>
            <Text className='pair-sheet__label'>目标 UUID</Text>
            <Input
              className='pair-sheet__input'
              maxlength={12}
              placeholder='例如 F42DC97179B4'
              value={manualUuid}
              onInput={(event) => onManualUuidChange(event.detail.value)}
            />
            {targetDeviceUuid ? (
              <Text className='pair-sheet__hint'>当前锁定：{targetDeviceUuid}</Text>
            ) : (
              <Text className='pair-sheet__hint'>
                可选。输入后会优先连接这台设备，不输入则连接当前可发现的 BeadCraft 设备。
              </Text>
            )}
          </View>
        </View>

        <View className='pair-sheet__footer'>
          <View className='pair-sheet__footer-button pair-sheet__footer-button--ghost' onClick={onClose}>
            <Text>取消</Text>
          </View>
          <View
            className='pair-sheet__footer-button pair-sheet__footer-button--primary'
            onClick={onConnect}
          >
            <Text>连接设备</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
