import { Button, Text, View } from '@tarojs/components'
import type { DeviceAlert, MonitoredDevice } from '@/domain/device-monitoring'
import './index.scss'

export interface DeviceMonitorPanelProps {
  device: MonitoredDevice | null
  alerts: DeviceAlert[]
  onAcknowledgeAlert?: (alertId: string) => void
}

function statusLabel(device: MonitoredDevice | null) {
  if (!device) return '等待设备连接'
  if (device.healthState === 'critical') return '严重故障'
  if (device.healthState === 'warning') return '需要检查'
  if (device.connectionState === 'online') return '设备在线'
  if (device.connectionState === 'offline') return '设备离线'
  if (device.connectionState === 'error') return '通信异常'
  return '状态未知'
}

export function DeviceMonitorPanel({
  device,
  alerts,
  onAcknowledgeAlert
}: DeviceMonitorPanelProps) {
  const activeAlerts = alerts.filter((alert) => alert.resolvedAt == null)
  const tone = device?.healthState ?? 'unknown'

  return (
    <View className={`device-monitor device-monitor--${tone}`}>
      <View className='device-monitor__header'>
        <View>
          <Text className='device-monitor__eyebrow'>实时设备监测</Text>
          <Text className='device-monitor__title'>{statusLabel(device)}</Text>
        </View>
        {device ? (
          <Text className='device-monitor__device-id'>{device.deviceId}</Text>
        ) : null}
      </View>

      {device ? (
        <View className='device-monitor__metrics'>
          <View className='device-monitor__metric'>
            <Text className='device-monitor__metric-value'>
              {device.lastSeenAt
                ? new Date(device.lastSeenAt).toLocaleTimeString()
                : '—'}
            </Text>
            <Text className='device-monitor__metric-label'>最近活动</Text>
          </View>
          <View className='device-monitor__metric'>
            <Text className='device-monitor__metric-value'>
              {device.telemetry?.brightness ?? '—'}
            </Text>
            <Text className='device-monitor__metric-label'>屏幕亮度</Text>
          </View>
          <View className='device-monitor__metric'>
            <Text className='device-monitor__metric-value'>{activeAlerts.length}</Text>
            <Text className='device-monitor__metric-label'>活动告警</Text>
          </View>
          <View className='device-monitor__metric'>
            <Text className='device-monitor__metric-value'>
              {device.telemetry?.boardWidth && device.telemetry?.boardHeight
                ? `${device.telemetry.boardWidth}×${device.telemetry.boardHeight}`
                : '—'}
            </Text>
            <Text className='device-monitor__metric-label'>设备板型</Text>
          </View>
          <View className='device-monitor__metric'>
            <Text className='device-monitor__metric-value'>
              {device.telemetry?.rotationDegrees != null
                ? `${device.telemetry.rotationDegrees}°`
                : '—'}
            </Text>
            <Text className='device-monitor__metric-label'>屏幕方向</Text>
          </View>
          <View className='device-monitor__metric'>
            <Text className='device-monitor__metric-value'>
              {device.telemetry?.passwordFlag == null
                ? '—'
                : device.telemetry.passwordFlag}
            </Text>
            <Text className='device-monitor__metric-label'>密码预留标志</Text>
          </View>
        </View>
      ) : (
        <Text className='device-monitor__hint'>连接设备后自动读取心跳、亮度和传输结果。</Text>
      )}

      {activeAlerts.length > 0 ? (
        <View className='device-monitor__alerts'>
          {activeAlerts.slice(0, 3).map((alert) => (
            <View
              className={`device-monitor__alert device-monitor__alert--${alert.severity}`}
              key={alert.id}
            >
              <View className='device-monitor__alert-copy'>
                <Text className='device-monitor__alert-message'>{alert.message}</Text>
                <Text className='device-monitor__alert-meta'>
                  {alert.code} · {alert.occurrences} 次
                </Text>
              </View>
              {alert.acknowledgedAt == null ? (
                <Button
                  className='device-monitor__acknowledge'
                  onClick={() => onAcknowledgeAlert?.(alert.id)}
                >
                  <Text>确认</Text>
                </Button>
              ) : (
                <Text className='device-monitor__acknowledged'>已确认</Text>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}
