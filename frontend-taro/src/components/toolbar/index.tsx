import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import type { ToolbarProps } from './types'
import './index.scss'

type ToolbarIconKind = 'home' | 'export'

function ToolbarIcon({ kind }: { kind: ToolbarIconKind }) {
  if (kind === 'home') {
    return (
      <View className='toolbar-icon toolbar-icon--home'>
        <View className='toolbar-icon__home-roof-left' />
        <View className='toolbar-icon__home-roof-right' />
        <View className='toolbar-icon__home-body' />
        <View className='toolbar-icon__home-door' />
      </View>
    )
  }

  return (
    <View className='toolbar-icon toolbar-icon--export'>
      <View className='toolbar-icon__export-arrow' />
      <View className='toolbar-icon__export-head-left' />
      <View className='toolbar-icon__export-head-right' />
      <View className='toolbar-icon__export-base' />
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
      <View className='toolbar-btn' onClick={onClear}>
        <ToolbarIcon kind='home' />
      </View>
      <View
        className={`toolbar-btn toolbar-btn--label ${removeBackground ? 'toolbar-btn--active' : ''}`}
        onClick={onToggleBackground}
      >
        <Text className='toolbar-btn__label-text'>背</Text>
      </View>
      <View className='toolbar-btn' onClick={onPickImage}>
        <Text className='toolbar-btn-icon'>+</Text>
      </View>
      <View className='led-size-btn' onClick={handlePickDifficulty}>
        <Text>{difficultyLabel}</Text>
      </View>
      <View className='led-size-btn' onClick={handlePickMatrixSize}>
        <Text>{ledSizeLabel}</Text>
      </View>
      <View
        className={`toolbar-btn mode-quick-btn ${modeQuickConnected ? 'mode-quick-btn--connected' : 'mode-quick-btn--disconnected'}`}
        onClick={onOpenPairSheet}
      >
        <Text>{modeQuickLabel}</Text>
      </View>
      <View className='toolbar-btn' onClick={onOpenSettings}>
        <ToolbarIcon kind='export' />
      </View>
    </View>
  )
}
