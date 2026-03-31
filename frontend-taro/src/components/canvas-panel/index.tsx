import { Text, View } from '@tarojs/components'
import './index.scss'

export interface CanvasPanelProps {
  showUploadGuide: boolean
  showDeviceChip?: boolean
  targetDeviceUuid?: string
}

export function CanvasPanel({
  showUploadGuide,
  showDeviceChip = false,
  targetDeviceUuid
}: CanvasPanelProps) {
  return (
    <View className='canvas-panel'>
      {showUploadGuide ? (
        <View className='canvas-panel__guide'>
          <Text className='canvas-panel__guide-icon'>QR</Text>
          <Text className='canvas-panel__guide-title'>先扫描设备二维码进行配对</Text>
          <Text className='canvas-panel__guide-desc'>
            已配对后可继续上传图片；也可在设置中切换 WiFi 模式
          </Text>
          {showDeviceChip && targetDeviceUuid ? (
            <View className='canvas-panel__device-chip'>
              <Text>已锁定设备 {targetDeviceUuid}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View className='canvas-panel__preview'>
          <View className='canvas-panel__preview-grid' />
          <Text className='canvas-panel__preview-title'>拼豆图预览区域</Text>
          <Text className='canvas-panel__preview-desc'>
            下一步会在这里接入生成后的像素画布与颜色高亮联动
          </Text>
        </View>
      )}
    </View>
  )
}
