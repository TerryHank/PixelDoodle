import { Text, View } from '@tarojs/components'
import type { ColorSummaryItem } from '@/types/api'
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
  activeCodes = [],
  onToggleColor
}: ColorPanelProps) {
  const hasActiveColors = activeCodes.length > 0

  return (
    <View className='color-panel section-block'>
      <Text className='section-block__title'>颜色统计</Text>
      {colors.length ? (
        <View className='color-panel__list'>
          {colors.map((item) => (
            <View
              key={item.code}
              className={`color-panel__row ${
                activeCodes.includes(item.code)
                  ? 'color-panel__row--active'
                  : hasActiveColors
                    ? 'color-panel__row--muted'
                    : ''
              }`}
              onClick={() => onToggleColor?.(item.code)}
            >
              <View className='color-panel__meta'>
                <View
                  className='color-panel__swatch'
                  style={{ background: item.hex }}
                />
                <View className='color-panel__text'>
                  <Text className='color-panel__name'>{item.name_zh || item.name}</Text>
                  <Text className='color-panel__code'>{item.code}</Text>
                </View>
              </View>
              <Text className='color-panel__count'>{item.count}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className='color-panel__empty'>生成图案后在这里查看颜色数量与高亮入口</Text>
      )}
      <Text className='color-panel__total'>总计 {totalBeads} 颗</Text>
    </View>
  )
}
