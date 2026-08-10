import { Text, View } from '@tarojs/components'
import type { ExportKind } from '@/services/pattern-service'
import './index.scss'

export interface SettingsSheetProps {
  visible: boolean
  onClose: () => void
  onExport: (kind: ExportKind) => void
}

export function SettingsSheet({
  visible,
  onClose,
  onExport
}: SettingsSheetProps) {
  if (!visible) {
    return null
  }

  return (
    <View className='settings-sheet'>
      <View className='settings-sheet__mask' onClick={onClose} />
      <View className='settings-sheet__panel'>
        <View className='settings-sheet__header'>
          <View>
            <Text className='settings-sheet__title'>导出</Text>
            <Text className='settings-sheet__subtitle'>选择要导出的文件格式</Text>
          </View>
          <View className='settings-sheet__close' onClick={onClose}>
            <Text>×</Text>
          </View>
        </View>

        <View className='settings-sheet__body'>
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
