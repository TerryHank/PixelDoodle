import { Text, View } from '@tarojs/components'
import './index.scss'

export interface ToolbarProps {
  targetDeviceUuid?: string
  removeBackground?: boolean
  difficultyLabel: string
  ledSizeLabel: string
  connectionModeLabel: string
  onToggleBackground?: () => void
  onClear?: () => void
  onPickImage?: () => void
  onOpenPairSheet?: () => void
  onOpenSettings?: () => void
}

export function Toolbar({
  targetDeviceUuid,
  removeBackground = false,
  difficultyLabel,
  ledSizeLabel,
  connectionModeLabel,
  onToggleBackground,
  onClear,
  onPickImage,
  onOpenPairSheet,
  onOpenSettings
}: ToolbarProps) {
  return (
    <View className='toolbar'>
      <View className='toolbar__spacer' />
      {targetDeviceUuid ? (
        <View className='toolbar__chip'>
          <Text className='toolbar__chip-label'>设备</Text>
          <Text className='toolbar__chip-value'>{targetDeviceUuid}</Text>
        </View>
      ) : null}
      <View
        className={`toolbar__button ${removeBackground ? 'toolbar__button--active' : ''}`}
        onClick={onToggleBackground}
      >
        <Text>背</Text>
      </View>
      <View className='toolbar__button' onClick={onClear}>
        <Text>清</Text>
      </View>
      <View className='toolbar__button' onClick={onPickImage}>
        <Text className='toolbar__button-plus'>+</Text>
      </View>
      <View className='toolbar__button' onClick={onOpenPairSheet}>
        <Text>扫</Text>
      </View>
      <View className='toolbar__button toolbar__button--compact'>
        <Text>{difficultyLabel}</Text>
      </View>
      <View className='toolbar__button toolbar__button--compact'>
        <Text>{ledSizeLabel}</Text>
      </View>
      <View className='toolbar__button toolbar__button--wide'>
        <Text>{connectionModeLabel}</Text>
      </View>
      <View className='toolbar__button' onClick={onOpenSettings}>
        <Text>设</Text>
      </View>
    </View>
  )
}
