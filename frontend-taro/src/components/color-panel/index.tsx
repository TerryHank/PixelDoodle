import { Text, View } from '@tarojs/components'
import { useDeviceStore } from '@/store/device-store'
import type { ColorSummaryItem } from '@/types/api'
import { formatColorTotalText } from '@/utils/pattern-render'
import './index.scss'

export interface ColorPanelProps {
  colors: ColorSummaryItem[]
  totalBeads: number
  activeCodes?: string[]
  onToggleColor?: (code: string) => void
}

export function ColorPanel({
  colors,
  totalBeads,
  activeCodes,
  onToggleColor
}: ColorPanelProps) {
  const storeActiveCodes = useDeviceStore((state) => state.activeHighlightCodes)
  const resolvedActiveCodes = activeCodes ?? storeActiveCodes
  const hasActiveColors = resolvedActiveCodes.length > 0

  return (
    <View className='color-panel'>
      {colors.length ? (
        <View className='color-list'>
          {colors.map((item) => (
            <View
              key={item.code}
              className={`color-tag ${
                resolvedActiveCodes.includes(item.code)
                  ? 'color-tag--active'
                  : hasActiveColors
                    ? 'color-tag--muted'
                    : ''
              }`}
              onClick={() => onToggleColor?.(item.code)}
            >
              <View
                className='color-swatch'
                style={{ background: item.hex }}
              />
            </View>
          ))}
        </View>
      ) : (
        <Text className='color-panel__empty'>生成图案后在这里查看颜色数量与高亮入口</Text>
      )}
      <Text className='color-total'>{formatColorTotalText(colors.length, totalBeads)}</Text>
    </View>
  )
}
