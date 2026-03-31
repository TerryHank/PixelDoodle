import { Input, Text, View } from '@tarojs/components'
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
  mode,
  manualUuid,
  targetDeviceUuid,
  bleConnectionStatus,
  wifiScanResults,
  selectedWifiHotspot,
  wifiPassword,
  registeredWifiDevice,
  onClose,
  onModeChange,
  onScan,
  onConnect,
  onManualUuidChange,
  onScanWifi,
  onSelectWifiHotspot,
  onWifiPasswordChange,
  onConnectWifi
}: PairSheetProps) {
  const isRnRuntime = process.env.TARO_ENV === 'rn'

  if (!visible) {
    return null
  }

  const footerPrimaryLabel =
    mode === 'wifi' && selectedWifiHotspot ? '连接 WiFi' : '连接设备'

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
          <View className='pair-sheet__mode-switch'>
            <View
              className={`pair-sheet__mode-pill ${mode === 'ble' ? 'pair-sheet__mode-pill--active' : ''}`}
              onClick={() => onModeChange('ble')}
            >
              <Text>蓝牙</Text>
            </View>
            <View
              className={`pair-sheet__mode-pill ${mode === 'wifi' ? 'pair-sheet__mode-pill--active' : ''}`}
              onClick={() => onModeChange('wifi')}
            >
              <Text>WiFi</Text>
            </View>
          </View>

          <View className='pair-sheet__scan-button' onClick={onScan}>
            <Text className='pair-sheet__scan-label'>扫描二维码</Text>
            <Text className='pair-sheet__scan-hint'>
              {mode === 'wifi'
                ? '先锁定设备 UUID，再通过蓝牙让 ESP32 扫描并连接热点'
                : '微信小程序可直接扫码；H5 可先手输 UUID'}
            </Text>
          </View>

          {isRnRuntime ? (
            <View className='pair-sheet__group'>
              <Text className='pair-sheet__hint'>RN Android 端当前请优先手动输入 UUID。</Text>
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
                {isRnRuntime
                  ? 'RN Android 端暂不支持扫码自动填充，请先手动输入 12 位 UUID'
                  : '不输入时可直接选择附近的 BeadCraft 设备'}
              </Text>
            )}
          </View>

          {mode === 'wifi' ? (
            <View className='pair-sheet__wifi-panel'>
              <View className='pair-sheet__wifi-header'>
                <Text className='pair-sheet__label'>热点列表</Text>
                <View className='pair-sheet__secondary-button' onClick={onScanWifi}>
                  <Text>扫描热点</Text>
                </View>
              </View>

              {registeredWifiDevice ? (
                <View className='pair-sheet__wifi-registered'>
                  <Text className='pair-sheet__hint'>
                    当前已注册中继：{registeredWifiDevice.device_uuid} / {registeredWifiDevice.ip}
                  </Text>
                </View>
              ) : null}

              {wifiScanResults.length ? (
                <View className='pair-sheet__wifi-list'>
                  {wifiScanResults.map((item) => {
                    const active = item.ssid === selectedWifiHotspot?.ssid

                    return (
                      <View
                        key={`${item.ssid}-${item.rssi ?? 0}`}
                        className={`pair-sheet__wifi-item ${active ? 'pair-sheet__wifi-item--active' : ''}`}
                        onClick={() => onSelectWifiHotspot(item)}
                      >
                        <View>
                          <Text className='pair-sheet__wifi-ssid'>{item.ssid}</Text>
                          <Text className='pair-sheet__wifi-meta'>
                            信号 {item.rssi ?? 0} dBm
                          </Text>
                        </View>
                        <Text className='pair-sheet__wifi-badge'>
                          {item.secure ? '已加密' : '开放'}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              ) : (
                <View className='pair-sheet__wifi-empty'>
                  <Text>连接蓝牙设备后点击“扫描热点”获取附近网络</Text>
                </View>
              )}

              {selectedWifiHotspot ? (
                <View className='pair-sheet__group'>
                  <Text className='pair-sheet__label'>
                    已选择热点：{selectedWifiHotspot.ssid}
                  </Text>
                  {selectedWifiHotspot.secure ? (
                    <Input
                      className='pair-sheet__input'
                      password
                      placeholder='请输入 WiFi 密码'
                      value={wifiPassword}
                      onInput={(event) => onWifiPasswordChange(event.detail.value)}
                    />
                  ) : (
                    <Text className='pair-sheet__hint'>该热点为开放网络，可直接连接</Text>
                  )}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View className='pair-sheet__footer'>
          <View className='pair-sheet__footer-button pair-sheet__footer-button--ghost' onClick={onClose}>
            <Text>取消</Text>
          </View>
          <View
            className='pair-sheet__footer-button pair-sheet__footer-button--primary'
            onClick={mode === 'wifi' && selectedWifiHotspot ? onConnectWifi : onConnect}
          >
            <Text>{footerPrimaryLabel}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
