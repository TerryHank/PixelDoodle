import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import { bleAdapter } from '@/adapters/ble'
import { scanAdapter } from '@/adapters/scan'
import { fileAdapter } from '@/adapters/file'
import { CanvasPanel } from '@/components/canvas-panel'
import { ColorPanel } from '@/components/color-panel'
import {
  type ExampleGalleryItem,
  ExampleGallery
} from '@/components/example-gallery'
import { PairSheet } from '@/components/pair-sheet'
import { ToastHost } from '@/components/toast-host'
import { Toolbar } from '@/components/toolbar'
import { useDeviceStore } from '@/store/device-store'
import { usePatternStore } from '@/store/pattern-store'
import { useUIStore } from '@/store/ui-store'
import type { ConnectionMode } from '@/types/device'
import { getApiBaseUrl } from '@/services/env'
import {
  exportPattern,
  type ExportKind
} from '@/services/pattern-service'
import {
  buildColorHexMap,
  getExportFileName,
  getExportMimeType
} from '@/utils/export'
import { isUuidLike, normalizeUuid } from '@/utils/uuid'
import { buildHomeViewModel } from './view-model'
import './index.scss'

const EXAMPLE_BASE_URL = getApiBaseUrl()

const EXAMPLE_ITEMS: ExampleGalleryItem[] = [
  {
    id: 'luoxiaohei',
    title: 'Luo Xiaohei',
    subtitle: '黑白留白',
    tone: 'ink',
    thumbnailUrl: `${EXAMPLE_BASE_URL}/examples/luoxiaohei_thumb.png`,
    sourceUrl: `${EXAMPLE_BASE_URL}/examples/luoxiaohei_original.jpg`
  },
  {
    id: 'meili',
    title: 'Meili',
    subtitle: '柔和肤色',
    tone: 'rose',
    thumbnailUrl: `${EXAMPLE_BASE_URL}/examples/meili_thumb.png`,
    sourceUrl: `${EXAMPLE_BASE_URL}/examples/meili_original.jpg`
  },
  {
    id: 'pony',
    title: 'Pony',
    subtitle: '高饱和撞色',
    tone: 'sky',
    thumbnailUrl: `${EXAMPLE_BASE_URL}/examples/pony_thumb.png`,
    sourceUrl: `${EXAMPLE_BASE_URL}/examples/pony_original.jpg`
  },
  {
    id: 'usachi',
    title: 'Usachi',
    subtitle: '糖果浅色系',
    tone: 'mint',
    thumbnailUrl: `${EXAMPLE_BASE_URL}/examples/usachi_thumb.png`,
    sourceUrl: `${EXAMPLE_BASE_URL}/examples/usachi_original.jpg`
  }
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

function hasGeneratedPattern(pixelMatrix: string[][] | (string | null)[][]) {
  return pixelMatrix.some((row) => row.length > 0)
}

export default function HomePage() {
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [manualUuid, setManualUuid] = useState('')

  const pixelMatrix = usePatternStore((state) => state.pixelMatrix)
  const colorSummary = usePatternStore((state) => state.colorSummary)
  const fullPaletteList = usePatternStore((state) => state.fullPaletteList)
  const totalBeads = usePatternStore((state) => state.totalBeads)
  const removeBackground = usePatternStore((state) => state.removeBackground)
  const ledSize = usePatternStore((state) => state.ledSize)
  const difficulty = usePatternStore((state) => state.difficulty)
  const previewImage = usePatternStore((state) => state.previewImage)

  const targetDeviceUuid = useDeviceStore((state) => state.targetDeviceUuid)
  const connectionMode = useDeviceStore((state) => state.connectionMode)
  const bleConnectionStatus = useDeviceStore((state) => state.bleConnectionStatus)
  const bleCharacteristicStatus = useDeviceStore((state) => state.bleCharacteristicStatus)
  const activeHighlightCodes = useDeviceStore((state) => state.activeHighlightCodes)

  const toastMessage = useUIStore((state) => state.toastMessage)
  const isPairSheetOpen = useUIStore((state) => state.isPairSheetOpen)

  useEffect(() => {
    if (fullPaletteList.length > 0) {
      return
    }

    usePatternStore
      .getState()
      .loadPalette()
      .catch(() => {
        showToast('调色板加载失败，请稍后重试')
      })
  }, [fullPaletteList.length])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  function showToast(message: string) {
    useUIStore.setState({
      toastMessage: message
    })

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }

    toastTimerRef.current = setTimeout(() => {
      useUIStore.setState({
        toastMessage: ''
      })
    }, 2400)
  }

  async function runGenerate(filePath: string, fileName?: string) {
    Taro.showLoading({
      title: '生成中...'
    })

    try {
      await usePatternStore.getState().generateFromFile(filePath, { fileName })
      useDeviceStore.getState().clearHighlightCodes()
      showToast('图案已生成')
    } finally {
      Taro.hideLoading()
    }
  }

  async function handlePickImage() {
    try {
      const result = await Taro.chooseImage({
        count: 1,
        sourceType: ['album']
      })
      const selected = result.tempFiles[0]
      const filePath = selected?.path || result.tempFilePaths[0]

      if (!filePath) {
        showToast('没有获取到可上传的图片')
        return
      }

      usePatternStore.getState().setExampleImage(null)
      await runGenerate(filePath, selected?.originalFileObj?.name)
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'errMsg' in error &&
        String(error.errMsg).includes('cancel')
      ) {
        return
      }

      showToast(error instanceof Error ? error.message : '图片上传失败')
    }
  }

  async function handleSelectExample(item: ExampleGalleryItem) {
    Taro.showLoading({
      title: '载入示例...'
    })

    try {
      usePatternStore.getState().setExampleImage(item.id)

      const response = await Taro.downloadFile({
        url: item.sourceUrl
      })

      if (response.statusCode >= 400 || !response.tempFilePath) {
        throw new Error('示例图片加载失败')
      }

      await runGenerate(response.tempFilePath, `${item.id}_original.jpg`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '示例图片加载失败')
    } finally {
      Taro.hideLoading()
    }
  }

  async function handleExport(kind: ExportKind) {
    const currentState = usePatternStore.getState()

    if (!hasGeneratedPattern(currentState.pixelMatrix)) {
      showToast('请先上传或选择示例图')
      return
    }

    const basePayload = {
      session_id: currentState.sessionId,
      pixel_matrix: currentState.pixelMatrix,
      color_summary: currentState.colorSummary,
      palette_preset: currentState.palettePreset
    }

    const payload =
      kind === 'png'
        ? {
            ...basePayload,
            color_data: buildColorHexMap(
              currentState.pixelMatrix,
              currentState.colorSummary,
              currentState.fullPalette
            ),
            cell_size: 20,
            show_grid: true,
            show_codes_in_cells: true,
            show_coordinates: true
          }
        : kind === 'pdf'
          ? {
              ...basePayload,
              show_codes_in_cells: true,
              show_coordinates: true
            }
          : {
              pixel_matrix: currentState.pixelMatrix,
              color_summary: currentState.colorSummary
            }

    Taro.showLoading({
      title: '导出中...'
    })

    try {
      const data = await exportPattern(kind, payload)
      await fileAdapter.saveBinaryFile(
        getExportFileName(kind, currentState.sessionId),
        getExportMimeType(kind),
        data
      )
      showToast(`已导出 ${kind.toUpperCase()}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败')
    } finally {
      Taro.hideLoading()
    }
  }

  async function handleOpenSettings() {
    if (!hasGeneratedPattern(pixelMatrix)) {
      showToast('请先上传或选择示例图')
      return
    }

    try {
      const result = await Taro.showActionSheet({
        itemList: ['导出 PNG', '导出 PDF', '导出 JSON']
      })
      const actions: ExportKind[] = ['png', 'pdf', 'json']
      const selected = actions[result.tapIndex]

      if (selected) {
        await handleExport(selected)
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

      showToast('导出菜单打开失败')
    }
  }

  async function handleToggleBackground() {
    const store = usePatternStore.getState()
    store.toggleRemoveBackground()

    if (!store.originalImage) {
      showToast(store.removeBackground ? '已关闭自动去背' : '已开启自动去背')
      return
    }

    try {
      await runGenerate(store.originalImage)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重新生成失败')
    }
  }

  function handleClear() {
    usePatternStore.getState().clear()
    useDeviceStore.getState().clearHighlightCodes()
    useUIStore.setState({
      toastMessage: ''
    })
  }

  function handleOpenPairSheet() {
    setManualUuid(targetDeviceUuid)
    useUIStore.setState({
      isPairSheetOpen: true
    })
  }

  function handleClosePairSheet() {
    useUIStore.setState({
      isPairSheetOpen: false
    })
  }

  async function handleScanDevice() {
    try {
      const scannedUuid = await scanAdapter.scanDevice()
      setManualUuid(scannedUuid)
      useDeviceStore.setState({
        targetDeviceUuid: scannedUuid
      })
      showToast(`已识别设备 ${scannedUuid}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '扫码失败')
    }
  }

  async function handleConnectDevice() {
    const normalizedUuid = manualUuid ? normalizeUuid(manualUuid) : ''

    if (normalizedUuid && !isUuidLike(normalizedUuid)) {
      showToast('请输入 12 位设备 UUID')
      return
    }

    useDeviceStore.setState({
      targetDeviceUuid: normalizedUuid || targetDeviceUuid
    })
    useDeviceStore.getState().setBleConnectionStatus('connecting')
    useDeviceStore.getState().setBleCharacteristicStatus('discovering')

    try {
      await bleAdapter.connectTargetDevice(normalizedUuid || undefined)
      useDeviceStore.getState().setBleConnectionStatus('connected')
      useDeviceStore.getState().setBleCharacteristicStatus('ready')
      useUIStore.setState({
        isPairSheetOpen: false
      })
      showToast(normalizedUuid ? `蓝牙已连接 ${normalizedUuid}` : '蓝牙连接成功')
    } catch (error) {
      useDeviceStore.getState().setBleConnectionStatus('error')
      useDeviceStore.getState().setBleCharacteristicStatus('error')
      showToast(error instanceof Error ? error.message : '蓝牙连接失败')
    }
  }

  async function handleToggleColor(code: string) {
    const nextCodes = useDeviceStore.getState().toggleHighlightCode(code)
    const highlightRgb = nextCodes
      .map((itemCode) => colorSummary.find((item) => item.code === itemCode)?.rgb)
      .filter((rgb): rgb is [number, number, number] => Array.isArray(rgb))

    if (
      connectionMode !== 'ble' ||
      bleConnectionStatus !== 'connected' ||
      bleCharacteristicStatus !== 'ready'
    ) {
      return
    }

    try {
      await bleAdapter.sendHighlight(highlightRgb)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '颜色高亮同步失败')
    }
  }

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
          onClear={handleClear}
          onOpenPairSheet={handleOpenPairSheet}
          onOpenSettings={handleOpenSettings}
          onPickImage={handlePickImage}
          onToggleBackground={handleToggleBackground}
        />
        <CanvasPanel
          previewImage={previewImage}
          showDeviceChip={vm.showDeviceChip}
          showUploadGuide={vm.showUploadGuide}
          targetDeviceUuid={targetDeviceUuid}
        />
        {vm.showExampleGallery ? (
          <ExampleGallery items={EXAMPLE_ITEMS} onSelectExample={handleSelectExample} />
        ) : null}
        {vm.showColorPanel ? (
          <ColorPanel
            activeCodes={activeHighlightCodes}
            colors={colorSummary}
            totalBeads={totalBeads}
            onToggleColor={handleToggleColor}
          />
        ) : null}
      </View>
      <PairSheet
        bleConnectionStatus={bleConnectionStatus}
        manualUuid={manualUuid}
        targetDeviceUuid={targetDeviceUuid}
        visible={isPairSheetOpen}
        onClose={handleClosePairSheet}
        onConnect={handleConnectDevice}
        onManualUuidChange={setManualUuid}
        onScan={handleScanDevice}
      />
      <ToastHost message={toastMessage} />
    </View>
  )
}
