import Taro from '@tarojs/taro'
import { Image, Picker, Text, View } from '@tarojs/components'
import exportIconUrl from '@/assets/icons/toolbar-export.svg'
import homeIconUrl from '@/assets/icons/toolbar-home.svg'
import {
  DEFAULT_GENERATION_STYLE_INDEX,
  GENERATION_STYLE_NAMES,
  GENERATION_STYLES
} from '@/constants/generation-styles'
import { BOARD_SIZE_OPTIONS } from '@/features/pixel-editor/model'
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
  boardSizeLabel,
  styleLabel,
  modeQuickLabel,
  modeQuickConnected = false,
  boardSizeValue = { width: 29, height: 29 },
  styleIndexValue = DEFAULT_GENERATION_STYLE_INDEX,
  onToggleBackground,
  onClear,
  onPickImage,
  onOpenPairSheet,
  onOpenSettings,
  onChangeBoardSize,
  onChangeStyle
}: ToolbarProps) {
  const selectedStyleOptionIndex = Math.max(
    0,
    GENERATION_STYLES.findIndex((item) => item.index === styleIndexValue)
  )

  async function handlePickMatrixSize() {
    if (!onChangeBoardSize) return

    const currentIndex = Math.max(
      0,
      BOARD_SIZE_OPTIONS.findIndex(
        (item) =>
          item.width === boardSizeValue.width && item.height === boardSizeValue.height
      )
    )

    try {
      const result = await Taro.showActionSheet({
        itemList: BOARD_SIZE_OPTIONS.map((item) => item.label),
        alertText: '选择尺寸'
      })
      const selected = BOARD_SIZE_OPTIONS[result.tapIndex]
      if (selected) {
        onChangeBoardSize({ width: selected.width, height: selected.height })
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'errMsg' in error &&
        String(error.errMsg).includes('cancel')
      ) {
        return
      }
      const current = BOARD_SIZE_OPTIONS[currentIndex]
      onChangeBoardSize({ width: current.width, height: current.height })
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
        <ToolbarPickerLabel value={boardSizeLabel} />
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
