import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import luoxiaoheiOriginal from '@/assets/examples/luoxiaohei_original.jpg'
import luoxiaoheiThumb from '@/assets/examples/luoxiaohei_thumb.png'
import meiliOriginal from '@/assets/examples/meili_original.jpg'
import meiliThumb from '@/assets/examples/meili_thumb.png'
import ponyOriginal from '@/assets/examples/pony_original.jpg'
import ponyThumb from '@/assets/examples/pony_thumb.png'
import usachiOriginal from '@/assets/examples/usachi_original.jpg'
import usachiThumb from '@/assets/examples/usachi_thumb.png'
import { bleAdapter } from '@/adapters/ble'
import { fileAdapter } from '@/adapters/file'
import { CanvasPanel } from '@/components/canvas-panel'
import { ColorPanel } from '@/components/color-panel'
import {
  type ExampleGalleryItem,
  ExampleGallery
} from '@/components/example-gallery'
import { PairSheet } from '@/components/pair-sheet'
import { SettingsSheet } from '@/components/settings-sheet'
import { ToastHost } from '@/components/toast-host'
import { Toolbar } from '@/components/toolbar'
import {
  exportPattern,
  type ExportKind
} from '@/services/pattern-service'
import { useDeviceStore } from '@/store/device-store'
import { usePatternStore } from '@/store/pattern-store'
import { useUIStore } from '@/store/ui-store'
import {
  buildColorHexMap,
  getExportFileName,
  getExportMimeType
} from '@/utils/export'
import { getRuntimeEnv } from '@/utils/runtime-env'
import { isUuidLike, normalizeUuid } from '@/utils/uuid'
import { resolveWeappUploadablePath } from '@/utils/weapp-upload'
import { buildHomeViewModel } from './view-model'
import './index.scss'

interface WeappMenuButtonRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface WeappChromeMetrics {
  pageTopPadding: number
  badgeTop: number
  badgeLeft: number
}

const DEFAULT_WEAPP_CHROME_METRICS: WeappChromeMetrics = {
  pageTopPadding: 56,
  badgeTop: 10,
  badgeLeft: 10
}

const EXAMPLE_ITEMS: ExampleGalleryItem[] = [
  {
    id: 'luoxiaohei',
    title: 'Luo Xiaohei',
    subtitle: '黑白留白',
    tone: 'ink',
    thumbnailUrl: luoxiaoheiThumb,
    sourceUrl: luoxiaoheiOriginal
  },
  {
    id: 'meili',
    title: 'Meili',
    subtitle: '柔和肤色',
    tone: 'rose',
    thumbnailUrl: meiliThumb,
    sourceUrl: meiliOriginal
  },
  {
    id: 'pony',
    title: 'Pony',
    subtitle: '高饱和撞色',
    tone: 'sky',
    thumbnailUrl: ponyThumb,
    sourceUrl: ponyOriginal
  },
  {
    id: 'usachi',
    title: 'Usachi',
    subtitle: '糖果浅色系',
    tone: 'mint',
    thumbnailUrl: usachiThumb,
    sourceUrl: usachiOriginal
  }
]

function getDifficultyLabel(difficulty: number) {
  if (difficulty <= 0.0625) return '易'
  if (difficulty <= 0.125) return '中'
  if (difficulty <= 0.25) return '难'
  return '原'
}

function getDifficultyValue(difficulty: number) {
  if (difficulty <= 0.0625) return '0.0625'
  if (difficulty <= 0.125) return '0.125'
  if (difficulty <= 0.25) return '0.25'
  return '1'
}

function getModeQuickPresentation(input: {
  bleConnectionStatus: string
  bleCharacteristicStatus: string
  targetDeviceUuid: string
}) {
  const isConnected =
    input.bleConnectionStatus === 'connected' &&
    input.bleCharacteristicStatus === 'ready' &&
    input.targetDeviceUuid.trim().length > 0

  return {
    connected: isConnected,
    label: isConnected ? input.targetDeviceUuid.trim().slice(0, 4) : '未连接'
  }
}

function hasGeneratedPattern(pixelMatrix: string[][] | (string | null)[][]) {
  return pixelMatrix.some((row) => row.length > 0)
}

function getWeappMenuButtonRect(): WeappMenuButtonRect | null {
  const wxLike =
    typeof globalThis !== 'undefined'
      ? (globalThis as {
          wx?: {
            getMenuButtonBoundingClientRect?: () => WeappMenuButtonRect
          }
        }).wx
      : undefined

  if (typeof wxLike?.getMenuButtonBoundingClientRect !== 'function') {
    return null
  }

  try {
    return wxLike.getMenuButtonBoundingClientRect()
  } catch {
    return null
  }
}

export default function HomePage() {
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [manualUuid, setManualUuid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')
  const [weappChromeMetrics, setWeappChromeMetrics] = useState<WeappChromeMetrics>(
    DEFAULT_WEAPP_CHROME_METRICS
  )
  const currentEnv = getRuntimeEnv()
  const isRnRuntime = currentEnv === 'rn'

  const pixelMatrix = usePatternStore((state) => state.pixelMatrix)
  const colorSummary = usePatternStore((state) => state.colorSummary)
  const fullPalette = usePatternStore((state) => state.fullPalette)
  const fullPaletteList = usePatternStore((state) => state.fullPaletteList)
  const totalBeads = usePatternStore((state) => state.totalBeads)
  const removeBackground = usePatternStore((state) => state.removeBackground)
  const ledSize = usePatternStore((state) => state.ledSize)
  const difficulty = usePatternStore((state) => state.difficulty)
  const previewImage = usePatternStore((state) => state.previewImage)

  const targetDeviceUuid = useDeviceStore((state) => state.targetDeviceUuid)
  const bleConnectionStatus = useDeviceStore((state) => state.bleConnectionStatus)
  const bleCharacteristicStatus = useDeviceStore((state) => state.bleCharacteristicStatus)

  const toastMessage = useUIStore((state) => state.toastMessage)
  const isPairSheetOpen = useUIStore((state) => state.isPairSheetOpen)
  const isSettingsSheetOpen = useUIStore((state) => state.isSettingsSheetOpen)

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

  useEffect(() => {
    if (currentEnv !== 'weapp') {
      return
    }

    try {
      const windowInfo =
        typeof Taro.getWindowInfo === 'function'
          ? Taro.getWindowInfo()
          : Taro.getSystemInfoSync()
      const menuRect = getWeappMenuButtonRect()
      const safeTop = windowInfo.safeArea?.top || windowInfo.statusBarHeight || 0

      const pageTopPadding = menuRect
        ? Math.max(Math.round(menuRect.bottom + 16), Math.round(safeTop + 52))
        : Math.round(safeTop + 52)
      const badgeTop = menuRect
        ? Math.max(Math.round(safeTop + 6), Math.round(menuRect.top))
        : Math.round(safeTop + 6)

      setWeappChromeMetrics({
        pageTopPadding,
        badgeTop,
        badgeLeft: 10
      })
    } catch {
      setWeappChromeMetrics(DEFAULT_WEAPP_CHROME_METRICS)
    }
  }, [currentEnv])

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
        sizeType: ['original'],
        sourceType: ['album', 'camera']
      })
      const selected = result.tempFiles[0]
      const rawFilePath = selected?.path || result.tempFilePaths[0]

      if (!rawFilePath) {
        showToast('没有获取到可上传的图片')
        return
      }

      let filePath = rawFilePath
      if (currentEnv === 'weapp' && typeof Taro.cropImage === 'function') {
        const cropped = await Taro.cropImage({
          src: rawFilePath,
          cropScale: '1:1'
        })
        if (cropped?.tempFilePath) {
          filePath = cropped.tempFilePath
        }
      }

      usePatternStore.getState().setExampleImage(null)
      const fileName =
        selected?.originalFileObj?.name ||
        filePath.split('/').filter(Boolean).pop() ||
        rawFilePath.split('/').filter(Boolean).pop()
      await runGenerate(filePath, fileName)
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

      if (currentEnv === 'weapp') {
        await runGenerate(
          resolveWeappUploadablePath(item.sourceUrl, `${item.id}_original.jpg`),
          `${item.id}_original.jpg`
        )
        return
      }

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

    if (isRnRuntime) {
      showToast('RN Android 端导出文件保存尚未接通，当前无法完成保存')
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

  function handleOpenSettings() {
    useUIStore.setState({
      isSettingsSheetOpen: true
    })
  }

  function handleCloseSettings() {
    useUIStore.setState({
      isSettingsSheetOpen: false
    })
  }

  function handleChangeLedSize(nextLedSize: number) {
    if (!Number.isFinite(nextLedSize) || nextLedSize <= 0) {
      return
    }

    usePatternStore.getState().setLedSize(nextLedSize)
  }

  async function handleChangeDifficulty(nextDifficultyValue: string) {
    const nextDifficulty = Number.parseFloat(nextDifficultyValue)

    if (!Number.isFinite(nextDifficulty) || nextDifficulty <= 0) {
      return
    }

    usePatternStore.getState().setDifficulty(nextDifficulty)

    const store = usePatternStore.getState()

    if (!store.originalImage) {
      return
    }

    try {
      await runGenerate(store.originalImage)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重新生成失败')
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

  async function ensureBleReady(uuid?: string) {
    if (
      bleConnectionStatus === 'connected' &&
      bleCharacteristicStatus === 'ready'
    ) {
      return
    }

    useDeviceStore.getState().setBleConnectionStatus('connecting')
    useDeviceStore.getState().setBleCharacteristicStatus('discovering')

    await bleAdapter.connectTargetDevice(uuid)
    useDeviceStore.getState().setBleConnectionStatus('connected')
    useDeviceStore.getState().setBleCharacteristicStatus('ready')
  }

  async function handleConnectDevice() {
    const normalizedUuid = manualUuid ? normalizeUuid(manualUuid) : ''

    if (normalizedUuid && !isUuidLike(normalizedUuid)) {
      showToast('请输入 12 位设备 UUID')
      return
    }

    const lockedUuid = normalizedUuid || targetDeviceUuid
    useDeviceStore.getState().setTargetDeviceUuid(lockedUuid)

    try {
      await ensureBleReady(lockedUuid || undefined)
      useUIStore.setState({
        isPairSheetOpen: false
      })
      showToast(lockedUuid ? `蓝牙已连接 ${lockedUuid}` : '蓝牙连接成功')
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

    try {
      if (bleConnectionStatus === 'connected' && bleCharacteristicStatus === 'ready') {
        await bleAdapter.sendHighlight(highlightRgb)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '颜色高亮同步失败')
    }
  }

  const vm = buildHomeViewModel({
    pixelMatrix,
    targetDeviceUuid,
    colorSummaryCount: colorSummary.length,
    env: currentEnv
  })
  const patternColorLookup = useMemo(
    () =>
      buildColorHexMap(pixelMatrix, colorSummary, fullPalette),
    [colorSummary, fullPalette, pixelMatrix]
  )
  const modeQuick = getModeQuickPresentation({
    bleConnectionStatus,
    bleCharacteristicStatus,
    targetDeviceUuid
  })

  function handleUploadAreaAction() {
    if (vm.uploadAreaMode === 'upload') {
      void handlePickImage()
      return
    }

    handleOpenPairSheet()
  }

  const versionBadgeStyle =
    currentEnv === 'weapp'
      ? {
          top: `${weappChromeMetrics.badgeTop}px`,
          left: `${weappChromeMetrics.badgeLeft}px`,
          right: 'auto'
        }
      : undefined

  const mainContainerStyle =
    currentEnv === 'weapp'
      ? {
          paddingTop: `${weappChromeMetrics.pageTopPadding}px`,
          paddingRight: '10px',
          paddingLeft: '10px',
          paddingBottom: '20px'
        }
      : undefined

  return (
    <View className={`home-page home-page--${currentEnv}`}>
      <View className='site-version-badge' style={versionBadgeStyle}>
        v10
      </View>
      <View className='main-container' style={mainContainerStyle}>
        <View className='result-area'>
          <Toolbar
            difficultyLabel={getDifficultyLabel(difficulty)}
            difficultyValue={getDifficultyValue(difficulty)}
            ledSizeLabel={String(ledSize)}
            ledSizeValue={ledSize}
            modeQuickConnected={modeQuick.connected}
            modeQuickLabel={modeQuick.label}
            removeBackground={removeBackground}
            targetDeviceUuid={vm.toolbarChipText}
            onClear={handleClear}
            onChangeDifficulty={handleChangeDifficulty}
            onChangeLedSize={handleChangeLedSize}
            onOpenPairSheet={handleOpenPairSheet}
            onOpenSettings={handleOpenSettings}
            onPickImage={handlePickImage}
            onToggleBackground={handleToggleBackground}
          />
          {vm.showRnCapabilityHint ? (
            <View className='rn-capability-hint'>
              <Text className='rn-capability-hint__text'>
                Android 端已启用 RN 工程；BLE、扫码与文件保存能力将逐步补齐。
              </Text>
            </View>
          ) : null}
          <CanvasPanel
            previewImage={previewImage}
            pixelMatrix={pixelMatrix}
            colorLookup={patternColorLookup}
            showUploadGuide={vm.showUploadGuide}
            uploadAreaMode={vm.uploadAreaMode}
            uploadAreaClassName={vm.uploadAreaClassName}
            uploadAreaIcon={vm.uploadAreaIcon}
            uploadAreaText={vm.uploadAreaText}
            uploadAreaHint={vm.uploadAreaHint}
            onUploadAreaClick={handleUploadAreaAction}
          />
          {vm.showExampleGallery ? (
            <ExampleGallery items={EXAMPLE_ITEMS} onSelectExample={handleSelectExample} />
          ) : null}
          {vm.showColorPanel ? (
            <ColorPanel
              colors={colorSummary}
              totalBeads={totalBeads}
              onToggleColor={handleToggleColor}
            />
          ) : null}
        </View>
      </View>
      <PairSheet
        bleConnectionStatus={bleConnectionStatus}
        manualUuid={manualUuid}
        targetDeviceUuid={targetDeviceUuid}
        visible={isPairSheetOpen}
        onClose={handleClosePairSheet}
        onConnect={handleConnectDevice}
        onManualUuidChange={setManualUuid}
        onModeChange={() => undefined}
        onScan={() => undefined}
        onScanWifi={() => undefined}
        onConnectWifi={() => undefined}
        onSelectWifiHotspot={() => undefined}
        onWifiPasswordChange={setWifiPassword}
        mode='ble'
        registeredWifiDevice={null}
        selectedWifiHotspot={null}
        wifiPassword={wifiPassword}
        wifiScanResults={[]}
      />
      <SettingsSheet
        visible={isSettingsSheetOpen}
        onClose={handleCloseSettings}
        onExport={handleExport}
      />
      <ToastHost message={toastMessage} />
    </View>
  )
}
