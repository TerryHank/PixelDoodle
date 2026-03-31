import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import { bleAdapter } from '@/adapters/ble'
import { fileAdapter } from '@/adapters/file'
import { scanAdapter } from '@/adapters/scan'
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
import { getApiBaseUrl } from '@/services/env'
import {
  exportPattern,
  type ExportKind
} from '@/services/pattern-service'
import {
  registerWifiDevice,
  sendWifiHighlight,
  sendWifiImage
} from '@/services/wifi-service'
import { useDeviceStore } from '@/store/device-store'
import { usePatternStore } from '@/store/pattern-store'
import { useUIStore } from '@/store/ui-store'
import type { ConnectionMode } from '@/types/device'
import {
  pixelMatrixToRgb565Bytes,
  scaleAndCenterPixelMatrix
} from '@/utils/ble-packet'
import {
  buildColorHexMap,
  getExportFileName,
  getExportMimeType
} from '@/utils/export'
import { isUuidLike, normalizeUuid } from '@/utils/uuid'
import { buildHomeViewModel } from './view-model'
import './index.scss'

const EXAMPLE_BASE_URL = getApiBaseUrl()
const DEFAULT_BACKGROUND_COLOR: [number, number, number] = [0, 0, 0]

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
  const [wifiPassword, setWifiPassword] = useState('')

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
  const wifiScanResults = useDeviceStore((state) => state.wifiScanResults)
  const selectedWifiHotspot = useDeviceStore((state) => state.selectedWifiHotspot)
  const registeredWifiDevice = useDeviceStore((state) => state.registeredWifiDevice)
  const isSending = useDeviceStore((state) => state.isSending)

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
      useDeviceStore.getState().setTargetDeviceUuid(scannedUuid)
      showToast(`已识别设备 ${scannedUuid}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '扫码失败')
    }
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

      if (connectionMode === 'wifi') {
        showToast('设备已连接，可开始扫描热点')
      } else {
        useUIStore.setState({
          isPairSheetOpen: false
        })
        showToast(lockedUuid ? `蓝牙已连接 ${lockedUuid}` : '蓝牙连接成功')
      }
    } catch (error) {
      useDeviceStore.getState().setBleConnectionStatus('error')
      useDeviceStore.getState().setBleCharacteristicStatus('error')
      showToast(error instanceof Error ? error.message : '蓝牙连接失败')
    }
  }

  function handleChangeConnectionMode(mode: ConnectionMode) {
    useDeviceStore.getState().setConnectionMode(mode)

    if (mode === 'wifi') {
      showToast('切到 WiFi 后，请通过顶部扫按钮完成热点配网')
    }
  }

  async function handleScanWifiHotspots() {
    const lockedUuid = normalizeUuid(manualUuid || targetDeviceUuid)
    if (!lockedUuid || !isUuidLike(lockedUuid)) {
      showToast('请先扫码或手输 12 位设备 UUID')
      return
    }

    useDeviceStore.getState().setTargetDeviceUuid(lockedUuid)
    useDeviceStore.getState().setSelectedWifiHotspot(null)
    Taro.showLoading({
      title: '扫描热点...'
    })

    try {
      await ensureBleReady(lockedUuid)
      const results = await bleAdapter.scanWifiNetworks()
      useDeviceStore.getState().setWifiScanResults(results)
      showToast(results.length ? `已发现 ${results.length} 个热点` : '未扫描到可用热点')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '热点扫描失败')
    } finally {
      Taro.hideLoading()
    }
  }

  async function handleConnectWifi() {
    const lockedUuid = normalizeUuid(manualUuid || targetDeviceUuid)
    if (!lockedUuid || !isUuidLike(lockedUuid)) {
      showToast('请先锁定目标设备 UUID')
      return
    }

    if (!selectedWifiHotspot) {
      showToast('请先选择要连接的热点')
      return
    }

    if (selectedWifiHotspot.secure && !wifiPassword.trim()) {
      showToast('请输入 WiFi 密码')
      return
    }

    Taro.showLoading({
      title: '联网中...'
    })

    try {
      await ensureBleReady(lockedUuid)
      const ip = await bleAdapter.connectWifiNetwork({
        ssid: selectedWifiHotspot.ssid,
        password: selectedWifiHotspot.secure ? wifiPassword : ''
      })
      const response = await registerWifiDevice({
        device_uuid: lockedUuid,
        ip
      })

      useDeviceStore.getState().setTargetDeviceUuid(lockedUuid)
      useDeviceStore.getState().setRegisteredWifiDevice({
        device_uuid: response.device_uuid,
        ip: response.ip,
        updated_at: Math.floor(Date.now() / 1000)
      })
      useDeviceStore.getState().setConnectionMode('wifi')
      useUIStore.setState({
        isPairSheetOpen: false
      })
      setWifiPassword('')
      showToast(`WiFi 已连接 ${response.ip}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'WiFi 配网失败')
    } finally {
      Taro.hideLoading()
    }
  }

  async function handleSendCurrentPattern() {
    const currentState = usePatternStore.getState()
    const deviceState = useDeviceStore.getState()

    if (!hasGeneratedPattern(currentState.pixelMatrix)) {
      showToast('请先上传或选择示例图')
      return
    }

    const mappedMatrix = scaleAndCenterPixelMatrix(
      currentState.pixelMatrix,
      currentState.ledSize
    )

    deviceState.setIsSending(true)

    try {
      if (deviceState.connectionMode === 'wifi') {
        const deviceUuid = normalizeUuid(deviceState.targetDeviceUuid)
        if (!deviceUuid) {
          useUIStore.setState({
            isPairSheetOpen: true,
            isSettingsSheetOpen: false
          })
          throw new Error('请先完成 WiFi 配网')
        }

        const result = await sendWifiImage({
          device_uuid: deviceUuid,
          pixel_matrix: mappedMatrix,
          background_color: DEFAULT_BACKGROUND_COLOR
        })

        deviceState.setRegisteredWifiDevice({
          device_uuid: result.device_uuid,
          ip: result.ip,
          updated_at: Math.floor(Date.now() / 1000)
        })
        showToast(`图案已通过 WiFi 发送到 ${result.ip}`)
      } else {
        if (
          bleConnectionStatus !== 'connected' ||
          bleCharacteristicStatus !== 'ready'
        ) {
          useUIStore.setState({
            isPairSheetOpen: true,
            isSettingsSheetOpen: false
          })
          throw new Error('请先连接蓝牙设备')
        }

        const payload = pixelMatrixToRgb565Bytes(
          mappedMatrix,
          currentState.fullPalette,
          DEFAULT_BACKGROUND_COLOR
        )
        await bleAdapter.sendImage(payload)
        showToast('图案已通过蓝牙发送')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '图案发送失败'

      if (message.includes('is not registered')) {
        useUIStore.setState({
          isPairSheetOpen: true,
          isSettingsSheetOpen: false
        })
      }

      showToast(message)
    } finally {
      deviceState.setIsSending(false)
    }
  }

  async function handleToggleColor(code: string) {
    const nextCodes = useDeviceStore.getState().toggleHighlightCode(code)
    const highlightRgb = nextCodes
      .map((itemCode) => colorSummary.find((item) => item.code === itemCode)?.rgb)
      .filter((rgb): rgb is [number, number, number] => Array.isArray(rgb))

    try {
      if (
        connectionMode === 'ble' &&
        bleConnectionStatus === 'connected' &&
        bleCharacteristicStatus === 'ready'
      ) {
        await bleAdapter.sendHighlight(highlightRgb)
      } else if (connectionMode === 'wifi') {
        const deviceUuid = normalizeUuid(targetDeviceUuid)

        if (!deviceUuid) {
          return
        }

        await sendWifiHighlight({
          device_uuid: deviceUuid,
          highlight_colors: highlightRgb
        })
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '颜色高亮同步失败'

      if (message.includes('is not registered')) {
        useUIStore.setState({
          isPairSheetOpen: true,
          isSettingsSheetOpen: false
        })
      }

      showToast(message)
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
        mode={connectionMode}
        registeredWifiDevice={registeredWifiDevice}
        selectedWifiHotspot={selectedWifiHotspot}
        targetDeviceUuid={targetDeviceUuid}
        visible={isPairSheetOpen}
        wifiPassword={wifiPassword}
        wifiScanResults={wifiScanResults}
        onClose={handleClosePairSheet}
        onConnect={handleConnectDevice}
        onConnectWifi={handleConnectWifi}
        onManualUuidChange={setManualUuid}
        onModeChange={handleChangeConnectionMode}
        onScan={handleScanDevice}
        onScanWifi={handleScanWifiHotspots}
        onSelectWifiHotspot={(hotspot) =>
          useDeviceStore.getState().setSelectedWifiHotspot(hotspot)
        }
        onWifiPasswordChange={setWifiPassword}
      />
      <SettingsSheet
        connectionMode={connectionMode}
        isSending={isSending}
        registeredWifiDevice={registeredWifiDevice}
        targetDeviceUuid={targetDeviceUuid}
        visible={isSettingsSheetOpen}
        onChangeMode={handleChangeConnectionMode}
        onClose={handleCloseSettings}
        onExport={handleExport}
        onSend={handleSendCurrentPattern}
      />
      <ToastHost message={toastMessage} />
    </View>
  )
}
