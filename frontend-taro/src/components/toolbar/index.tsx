import Taro from '@tarojs/taro'
import { Image, Picker, Text, View } from '@tarojs/components'
import exportIconUrl from '@/assets/icons/toolbar-export.svg'
import homeIconUrl from '@/assets/icons/toolbar-home.svg'
import {
  DEFAULT_GENERATION_STYLE_INDEX,
  GENERATION_STYLE_NAMES,
  GENERATION_STYLES
} from '@/constants/generation-styles'
import type { ToolbarProps } from './types'
import './index.scss'

const TOOLBAR_HOVER_PROPS = {
  hoverClass: 'toolbar-tap-hover',
  hoverStartTime: 0,
  hoverStayTime: 40
} as const

function ToolbarIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <Image className='toolbar-icon-image' mode='aspectFit' src={src} aria-label={alt} />
  )
}

export function ToolbarPickerLabel({ value }: { value: string }) {
  return (
    <View className='toolbar-picker-label'>
      <Text className='toolbar-picker-label__value'>{value}</Text>
    </View>
  )
}

export function Toolbar({
  removeBackground = false,
  ledSizeLabel,
  styleLabel,
  modeQuickLabel,
  modeQuickConnected = false,
  ledSizeValue = 64,
  styleIndexValue = DEFAULT_GENERATION_STYLE_INDEX,
  onToggleBackground,
  onClear,
  onPickImage,
  onOpenPairSheet,
  onOpenSettings,
  onChangeLedSize,
  onChangeStyle
}: ToolbarProps) {
  const matrixOptions = [16, 32, 52, 64] as const
  const selectedStyleOptionIndex = Math.max(
    0,
    GENERATION_STYLES.findIndex((item) => item.index === styleIndexValue)
  )

  async function handlePickMatrixSize() {
    if (!onChangeLedSize) return

    const currentIndex = Math.max(
      0,
      matrixOptions.findIndex((item) => item === ledSizeValue)
    )

    try {
      const result = await Taro.showActionSheet({
        itemList: matrixOptions.map((item) => String(item)),
        alertText: '选择尺寸'
      })
      onChangeLedSize(matrixOptions[result.tapIndex])
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'errMsg' in error &&
        String(error.errMsg).includes('cancel')
      ) {
        return
      }
      onChangeLedSize(matrixOptions[currentIndex])
    }
  }

  return (
    <View className='canvas-toolbar'>
      <View className='toolbar-btn' onClick={onClear} {...TOOLBAR_HOVER_PROPS}>
        <ToolbarIcon alt='回到主页' src={homeIconUrl} />
      </View>
      <View
        className={`toolbar-btn toolbar-btn--label ${removeBackground ? 'toolbar-btn--active' : ''}`}
        onClick={onToggleBackground}
        {...TOOLBAR_HOVER_PROPS}
      >
        <Text className='toolbar-btn__label-text'>背</Text>
      </View>
      <View className='toolbar-btn' onClick={onPickImage} {...TOOLBAR_HOVER_PROPS}>
        <Text className='toolbar-btn-icon'>+</Text>
      </View>
      <Picker
        mode='selector'
        range={GENERATION_STYLE_NAMES}
        value={selectedStyleOptionIndex}
        onChange={(event) => {
          const selectedStyle = GENERATION_STYLES[Number(event.detail.value)]
          if (selectedStyle) {
            onChangeStyle?.(selectedStyle.index)
          }
        }}
      >
        <View
          className='led-size-btn led-size-btn--picker generation-style-picker'
          {...TOOLBAR_HOVER_PROPS}
        >
          <ToolbarPickerLabel value={styleLabel} />
        </View>
      </Picker>
      <View
        className='led-size-btn led-size-btn--picker'
        onClick={handlePickMatrixSize}
        {...TOOLBAR_HOVER_PROPS}
      >
        <ToolbarPickerLabel value={ledSizeLabel} />
      </View>
      <View
        className={`toolbar-btn mode-quick-btn ${modeQuickConnected ? 'mode-quick-btn--connected' : 'mode-quick-btn--disconnected'}`}
        onClick={onOpenPairSheet}
        {...TOOLBAR_HOVER_PROPS}
      >
        <Text className='mode-quick-btn__text'>{modeQuickLabel}</Text>
      </View>
      <View className='toolbar-btn' onClick={onOpenSettings} {...TOOLBAR_HOVER_PROPS}>
        <ToolbarIcon alt='导出' src={exportIconUrl} />
      </View>
    </View>
  )
}
