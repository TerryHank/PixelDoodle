import { View } from '@tarojs/components'
import { CanvasPanel } from '@/components/canvas-panel'
import { ColorPanel } from '@/components/color-panel'
import {
  type ExampleGalleryItem,
  ExampleGallery
} from '@/components/example-gallery'
import { ToastHost } from '@/components/toast-host'
import { Toolbar } from '@/components/toolbar'
import { useDeviceStore } from '@/store/device-store'
import { usePatternStore } from '@/store/pattern-store'
import { useUIStore } from '@/store/ui-store'
import type { ConnectionMode } from '@/types/device'
import { buildHomeViewModel } from './view-model'
import './index.scss'

const EXAMPLE_ITEMS: ExampleGalleryItem[] = [
  { id: 'luoxiaohei', title: 'Luo Xiaohei', subtitle: '黑白留白', tone: 'ink' },
  { id: 'meili', title: 'Meili', subtitle: '柔和肤色', tone: 'rose' },
  { id: 'pony', title: 'Pony', subtitle: '高饱和撞色', tone: 'sky' },
  { id: 'usachi', title: 'Usachi', subtitle: '糖果浅色系', tone: 'mint' }
]

function getDifficultyLabel(difficulty: number) {
  if (difficulty <= 0.0625) return '易'
  if (difficulty <= 0.125) return '中'
  if (difficulty <= 0.25) return '难'
  return '原'
}

function getConnectionModeLabel(mode: ConnectionMode) {
  return mode === 'wifi' ? 'WiFi' : '蓝牙'
}

const noop = () => undefined

export default function HomePage() {
  const pixelMatrix = usePatternStore((state) => state.pixelMatrix)
  const colorSummary = usePatternStore((state) => state.colorSummary)
  const totalBeads = usePatternStore((state) => state.totalBeads)
  const removeBackground = usePatternStore((state) => state.removeBackground)
  const ledSize = usePatternStore((state) => state.ledSize)
  const difficulty = usePatternStore((state) => state.difficulty)

  const targetDeviceUuid = useDeviceStore((state) => state.targetDeviceUuid)
  const connectionMode = useDeviceStore((state) => state.connectionMode)

  const toastMessage = useUIStore((state) => state.toastMessage)

  const vm = buildHomeViewModel({
    pixelMatrix,
    targetDeviceUuid,
    colorSummaryCount: colorSummary.length
  })

  return (
    <View className='home-page'>
      <View className='home-page__badge'>vNext</View>
      <View className='home-page__shell'>
        <Toolbar
          connectionModeLabel={getConnectionModeLabel(connectionMode)}
          difficultyLabel={getDifficultyLabel(difficulty)}
          ledSizeLabel={String(ledSize)}
          removeBackground={removeBackground}
          targetDeviceUuid={targetDeviceUuid}
          onClear={noop}
          onOpenPairSheet={noop}
          onOpenSettings={noop}
          onPickImage={noop}
          onToggleBackground={noop}
        />
        <CanvasPanel
          showDeviceChip={vm.showDeviceChip}
          showUploadGuide={vm.showUploadGuide}
          targetDeviceUuid={targetDeviceUuid}
        />
        {vm.showExampleGallery ? <ExampleGallery items={EXAMPLE_ITEMS} /> : null}
        {vm.showColorPanel ? (
          <ColorPanel colors={colorSummary} totalBeads={totalBeads} />
        ) : null}
      </View>
      <ToastHost message={toastMessage} />
    </View>
  )
}
