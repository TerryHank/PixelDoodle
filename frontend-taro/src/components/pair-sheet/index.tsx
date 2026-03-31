import { Input, Text, View } from '@tarojs/components'
import type { DeviceConnectionStatus } from '@/types/device'
import './index.scss'

export interface PairSheetProps {
  visible: boolean
  manualUuid: string
  targetDeviceUuid?: string
  bleConnectionStatus: DeviceConnectionStatus
  onClose: () => void
  onScan: () => void
  onConnect: () => void
  onManualUuidChange: (value: string) => void
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
  onScan,
  onConnect,
  onManualUuidChange
}: PairSheetProps) {
  if (!visible) {
    return null
  }

  return (
    <View className='pair-sheet'>
      <View className='pair-sheet__mask' onClick={onClose} />
      <View className='pair-sheet__panel'>
        <View className='pair-sheet__header'>
          <View>
            <Text className='pair-sheet__title'>连接设备</Text>
            <Text className='pair-sheet__subtitle'>扫描二维码或手输 UUID 后连接目标 ESP32</Text>
          </View>
          <View className='pair-sheet__close' onClick={onClose}>
            <Text>关闭</Text>
          </View>
        </View>

        <View className='pair-sheet__status'>
          <Text className='pair-sheet__status-label'>状态</Text>
          <Text className='pair-sheet__status-value'>{getStatusLabel(bleConnectionStatus)}</Text>
        </View>

        <View className='pair-sheet__body'>
          <View className='pair-sheet__scan-button' onClick={onScan}>
            <Text className='pair-sheet__scan-label'>扫描二维码</Text>
            <Text className='pair-sheet__scan-hint'>微信小程序可直接扫码；H5 可先手输 UUID</Text>
          </View>

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
              <Text className='pair-sheet__hint'>不输入时可直接选择附近的 BeadCraft 设备</Text>
            )}
          </View>
        </View>

        <View className='pair-sheet__footer'>
          <View className='pair-sheet__footer-button pair-sheet__footer-button--ghost' onClick={onClose}>
            <Text>取消</Text>
          </View>
          <View className='pair-sheet__footer-button pair-sheet__footer-button--primary' onClick={onConnect}>
            <Text>连接设备</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
