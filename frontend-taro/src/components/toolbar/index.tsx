import Taro from '@tarojs/taro'
import { Image, Text, View } from '@tarojs/components'
import exportIconUrl from '@/assets/icons/toolbar-export.svg'
import homeIconUrl from '@/assets/icons/toolbar-home.svg'
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
  difficultyLabel,
  ledSizeLabel,
  modeQuickLabel,
  modeQuickConnected = false,
  difficultyValue = '0.125',
  ledSizeValue = 64,
  onToggleBackground,
  onClear,
  onPickImage,
  onOpenPairSheet,
  onOpenSettings,
  onChangeDifficulty,
  onChangeLedSize
}: ToolbarProps) {
  const difficultyOptions = [
    { label: '原', value: '1' },
    { label: '难', value: '0.25' },
    { label: '中', value: '0.125' },
    { label: '易', value: '0.0625' }
  ] as const

  const matrixOptions = [16, 32, 52, 64] as const

  async function handlePickDifficulty() {
    if (!onChangeDifficulty) return

    const currentIndex = Math.max(
      0,
      difficultyOptions.findIndex((item) => item.value === difficultyValue)
    )

    try {
      const result = await Taro.showActionSheet({
        itemList: difficultyOptions.map((item) => item.label),
        alertText: '选择难度'
      })
      onChangeDifficulty(difficultyOptions[result.tapIndex].value)
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'errMsg' in error &&
        String(error.errMsg).includes('cancel')
      ) {
        return
      }
      onChangeDifficulty(difficultyOptions[currentIndex].value)
    }
  }

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
      <View
        className='led-size-btn led-size-btn--picker'
        onClick={handlePickDifficulty}
        {...TOOLBAR_HOVER_PROPS}
      >
        <ToolbarPickerLabel value={difficultyLabel} />
      </View>
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
