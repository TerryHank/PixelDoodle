import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, Input, Switch, Text, Textarea, View } from '@tarojs/components'
import luoxiaoheiOriginal from '@/assets/examples/luoxiaohei_original.jpg'
import meiliOriginal from '@/assets/examples/meili_original.jpg'
import ponyOriginal from '@/assets/examples/pony_original.jpg'
import usachiOriginal from '@/assets/examples/usachi_original.jpg'
import { bleAdapter } from '@/adapters/ble'
import type { BleKnownDevice } from '@/adapters/ble/types'
import { fileAdapter } from '@/adapters/file'
import { CanvasPanel } from '@/components/canvas-panel'
import { ColorPanel } from '@/components/color-panel'
import { AppTabBar } from '@/components/app-tab-bar'
import {
  type ExampleGalleryItem,
  ExampleGallery
} from '@/components/example-gallery'
import { PairSheet, type PairSheetBleOption } from '@/components/pair-sheet'
import { PatternThumb } from '@/components/pattern-thumb'
import { ProfileAvatar } from '@/components/profile-avatar'
import { SettingsSheet } from '@/components/settings-sheet'
import { ToastHost } from '@/components/toast-host'
import { Toolbar } from '@/components/toolbar'
import { publishCommunityPost } from '@/services/community-service'
import {
  exportPattern,
  type ExportKind
} from '@/services/pattern-service'
import { autoSendGeneratedPattern } from '@/services/ble-image-sync'
import { registerWeappRasterLoader } from '@/services/weapp-raster-loader'
import { useDeviceStore } from '@/store/device-store'
import { useHistoryStore } from '@/store/history-store'
import { usePatternStore } from '@/store/pattern-store'
import { useUIStore } from '@/store/ui-store'
import { useUserStore } from '@/store/user-store'
import {
  buildColorHexMap,
  getExportFileName,
  getExportMimeType
} from '@/utils/export'
import { getRuntimeEnv } from '@/utils/runtime-env'
import { resolveWeappUploadablePath } from '@/utils/weapp-upload'
import { buildHomeViewModel } from './view-model'
import { applyPatternChangeAndMaybeRegenerate } from './pattern-regeneration'
import { hideLoadingSafely } from '@/utils/loading'
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
    thumbnailUrl: luoxiaoheiOriginal,
    sourceUrl: luoxiaoheiOriginal
  },
  {
    id: 'meili',
    title: 'Meili',
    subtitle: '柔和肤色',
    tone: 'rose',
    thumbnailUrl: meiliOriginal,
    sourceUrl: meiliOriginal
  },
  {
    id: 'pony',
    title: 'Pony',
    subtitle: '高饱和撞色',
    tone: 'sky',
    thumbnailUrl: ponyOriginal,
    sourceUrl: ponyOriginal
  },
  {
    id: 'usachi',
    title: 'Usachi',
    subtitle: '糖果浅色系',
    tone: 'mint',
    thumbnailUrl: usachiOriginal,
    sourceUrl: usachiOriginal
  }
]

const LOCAL_GENERATION_CANVAS_ID = 'local-generation-canvas'

type WeappLocalCanvasNode = HTMLCanvasElement & {
  width: number
  height: number
  createImage?: () => {
    src: string
    onload: (() => void) | null
    onerror: ((error: unknown) => void) | null
  }
  getContext: (kind: '2d') => CanvasRenderingContext2D | null
}

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

function sanitizePatternTitle(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return '未命名图案'
  }

  return trimmed.replace(/\.[A-Za-z0-9]+$/, '')
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
  const localGenerationCanvasNodeRef = useRef<WeappLocalCanvasNode | null>(null)
  const localGenerationCanvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const localGenerationCanvasReadyRef = useRef<
    Promise<{
      node: WeappLocalCanvasNode
      context: CanvasRenderingContext2D
    }> | null
  >(null)
  const [nearbyBleDevices, setNearbyBleDevices] = useState<BleKnownDevice[]>([])
  const [isBleScanning, setIsBleScanning] = useState(false)
  const [shareTitle, setShareTitle] = useState('')
  const [shareDescription, setShareDescription] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
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
  const historyEntries = useHistoryStore((state) => state.entries)
  const userId = useUserStore((state) => state.id)
  const userNickname = useUserStore((state) => state.nickname)
  const userAvatarSeed = useUserStore((state) => state.avatarSeed)
  const autoShareToCommunity = useUserStore((state) => state.autoShareToCommunity)
  const setAutoShareToCommunity = useUserStore((state) => state.setAutoShareToCommunity)

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

  useEffect(() => {
    if (currentEnv !== 'weapp') {
      registerWeappRasterLoader(null)
      return
    }

    const ensureLocalGenerationCanvas = async () => {
      if (localGenerationCanvasNodeRef.current && localGenerationCanvasContextRef.current) {
        return {
          node: localGenerationCanvasNodeRef.current,
          context: localGenerationCanvasContextRef.current
        }
      }

      if (localGenerationCanvasReadyRef.current) {
        return localGenerationCanvasReadyRef.current
      }

      localGenerationCanvasReadyRef.current = new Promise((resolve, reject) => {
        Taro.nextTick(() => {
          Taro.createSelectorQuery()
            .select(`#${LOCAL_GENERATION_CANVAS_ID}`)
            .fields({ node: true, size: true } as never)
            .exec((result) => {
              const canvasNode = result?.[0]?.node as WeappLocalCanvasNode | undefined
              if (!canvasNode) {
                localGenerationCanvasReadyRef.current = null
                reject(new Error('小程序本地生成画布初始化失败'))
                return
              }

              const context = canvasNode.getContext('2d')
              if (!context) {
                localGenerationCanvasReadyRef.current = null
                reject(new Error('小程序本地生成画布上下文初始化失败'))
                return
              }

              localGenerationCanvasNodeRef.current = canvasNode
              localGenerationCanvasContextRef.current = context
              resolve({
                node: canvasNode,
                context
              })
            })
        })
      })

      return localGenerationCanvasReadyRef.current
    }

    const loadRaster = async (sourcePath: string, width: number, height: number) => {
      const { node, context } = await ensureLocalGenerationCanvas()
      const imageFactory = node.createImage

      if (typeof imageFactory !== 'function') {
        throw new Error('当前微信小程序环境不支持本地图片解码画布')
      }

      const image = imageFactory.call(node)
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = (error) => reject(error || new Error('图片解码失败'))
        image.src = sourcePath
      })

      node.width = Math.max(1, width)
      node.height = Math.max(1, height)

      if (typeof context.setTransform === 'function') {
        context.setTransform(1, 0, 0, 1, 0, 0)
      }

      context.clearRect(0, 0, width, height)
      context.drawImage(image as never, 0, 0, width, height)
      const imageData = context.getImageData(0, 0, width, height)

      return {
        width,
        height,
        data: new Uint8ClampedArray(imageData.data)
      }
    }

    registerWeappRasterLoader({
      loadRaster
    })

    return () => {
      registerWeappRasterLoader(null)
      localGenerationCanvasReadyRef.current = null
      localGenerationCanvasNodeRef.current = null
      localGenerationCanvasContextRef.current = null
    }
  }, [currentEnv])

  useEffect(() => {
    if (!isPairSheetOpen) {
      return
    }

    if (typeof bleAdapter.scanNearbyDevices !== 'function') {
      return
    }

    void refreshBleDevices()
  }, [isPairSheetOpen])

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

  async function publishCurrentPattern(options?: {
    title?: string
    description?: string
  }) {
    const patternState = usePatternStore.getState()
    if (!hasGeneratedPattern(patternState.pixelMatrix)) {
      throw new Error('请先生成图案再发布到社区')
    }

    const title = sanitizePatternTitle(
      options?.title || shareTitle || `图案 ${new Date().toLocaleString()}`
    )

    setIsPublishing(true)
    try {
      await publishCommunityPost({
        title,
        description: (options?.description ?? shareDescription).trim(),
        author_id: userId,
        author_nickname: userNickname.trim() || '像素玩家',
        author_avatar_seed: userAvatarSeed || userNickname || '像素玩家',
        palette_preset: patternState.palettePreset,
        grid_size: patternState.gridSize,
        total_beads: patternState.totalBeads,
        pixel_matrix: patternState.pixelMatrix,
        color_summary: patternState.colorSummary
      })
    } finally {
      setIsPublishing(false)
    }
  }

  function rememberGeneratedPattern(input: {
    title: string
    sourceLabel: string
  }) {
    const patternState = usePatternStore.getState()
    useHistoryStore.getState().addEntry({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: sanitizePatternTitle(input.title),
      createdAt: new Date().toISOString(),
      sourceLabel: input.sourceLabel,
      gridSize: patternState.gridSize,
      totalBeads: patternState.totalBeads,
      palettePreset: patternState.palettePreset,
      pixelMatrix: patternState.pixelMatrix,
      colorSummary: patternState.colorSummary
    })
  }

  async function runGenerate(filePath: string, fileName?: string) {
    Taro.showLoading({
      title: '生成中...'
    })

    try {
      const response = await usePatternStore.getState().generateFromFile(filePath, { fileName })
      useDeviceStore.getState().clearHighlightCodes()
      const nextTitle = sanitizePatternTitle(fileName || shareTitle || '未命名图案')
      rememberGeneratedPattern({
        title: nextTitle,
        sourceLabel: fileName ? '上传图片' : '示例图'
      })

      if (!shareTitle.trim()) {
        setShareTitle(nextTitle)
      }

      let sentToBle = false
      let sendErrorMessage = ''
      let publishMessage = ''

      try {
        const patternState = usePatternStore.getState()
        const deviceState = useDeviceStore.getState()

        if (!deviceState.isSending) {
          deviceState.setIsSending(true)
          sentToBle = await autoSendGeneratedPattern({
            bleConnectionStatus: deviceState.bleConnectionStatus,
            bleCharacteristicStatus: deviceState.bleCharacteristicStatus,
            isSending: deviceState.isSending,
            ledSize: patternState.ledSize,
            pixelMatrix: patternState.pixelMatrix,
            palette: patternState.fullPalette,
            sendImage: (payload) => bleAdapter.sendImage(payload)
          })
        }
      } catch (error) {
        sendErrorMessage =
          error instanceof Error ? error.message : '蓝牙发送失败'
      } finally {
        useDeviceStore.getState().setIsSending(false)
      }

      if (autoShareToCommunity) {
        try {
          await publishCurrentPattern({
            title: nextTitle
          })
          publishMessage = '，并已同步到社区'
        } catch (error) {
          publishMessage = `，但社区发布失败：${
            error instanceof Error ? error.message : '发布失败'
          }`
        }
      }

      showToast(
        sendErrorMessage
          ? `图案已生成，但蓝牙发送失败：${sendErrorMessage}${publishMessage}`
          : sentToBle
            ? `图案已生成并已推送到设备${publishMessage}`
            : `图案已生成${publishMessage}`
      )
      return response
    } finally {
      void hideLoadingSafely(() => Taro.hideLoading())
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
    try {
      usePatternStore.getState().setExampleImage(item.id)

      if (currentEnv === 'weapp') {
        const examplePath = await resolveWeappUploadablePath(
          item.sourceUrl,
          `${item.id}_original.jpg`
        )
        await runGenerate(
          examplePath,
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

    void applyPatternChangeAndMaybeRegenerate({
      applyChange: () => {
        usePatternStore.getState().setLedSize(nextLedSize)
      },
      originalImage: usePatternStore.getState().originalImage,
      regenerate: runGenerate
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : '重新生成失败')
    })
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

  async function refreshBleDevices() {
    if (typeof bleAdapter.scanNearbyDevices !== 'function') {
      setNearbyBleDevices([])
      return []
    }

    setIsBleScanning(true)

    try {
      const devices = await bleAdapter.scanNearbyDevices()
      setNearbyBleDevices(devices)
      return devices
    } catch (error) {
      setNearbyBleDevices([])
      showToast(error instanceof Error ? error.message : '蓝牙搜索失败')
      return []
    } finally {
      setIsBleScanning(false)
    }
  }

  async function handleOpenPairSheet() {
    useUIStore.setState({
      isPairSheetOpen: true
    })

    if (typeof bleAdapter.scanNearbyDevices === 'function') {
      await refreshBleDevices()
    }
  }

  function handleClosePairSheet() {
    useUIStore.setState({
      isPairSheetOpen: false
    })
  }

  async function handleBleConnection(connect: () => Promise<string | null>) {
    useDeviceStore.getState().setBleConnectionStatus('connecting')
    useDeviceStore.getState().setBleCharacteristicStatus('discovering')

    try {
      const connectedUuid = (await connect())?.trim().toUpperCase() || ''

      if (!connectedUuid) {
        throw new Error('蓝牙连接成功，但设备 UUID 为空')
      }

      useDeviceStore.getState().setTargetDeviceUuid(connectedUuid)
      useDeviceStore.getState().setBleConnectionStatus('connected')
      useDeviceStore.getState().setBleCharacteristicStatus('ready')
      useUIStore.setState({
        isPairSheetOpen: false
      })
      showToast(`蓝牙已连接 ${connectedUuid}`)
    } catch (error) {
      useDeviceStore.getState().setBleConnectionStatus('error')
      useDeviceStore.getState().setBleCharacteristicStatus('error')
      showToast(error instanceof Error ? error.message : '蓝牙连接失败')
    }
  }

  async function handleAddBleDevice() {
    if (typeof bleAdapter.scanNearbyDevices === 'function') {
      await refreshBleDevices()
      return
    }

    await handleBleConnection(async () => {
      if (typeof bleAdapter.addTargetDevice === 'function') {
        return await bleAdapter.addTargetDevice()
      }
      return await bleAdapter.connectTargetDevice()
    })
  }

  async function handleSelectBleDevice(deviceKey: string) {
    await handleBleConnection(async () => {
      if (typeof bleAdapter.connectKnownDevice === 'function') {
        return await bleAdapter.connectKnownDevice(deviceKey)
      }

      const target = nearbyBleDevices.find((device) => device.key === deviceKey)
      return await bleAdapter.connectTargetDevice(target?.uuid || undefined)
    })
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
  const hasPattern = hasGeneratedPattern(pixelMatrix)
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
  const bleAvailable =
    currentEnv === 'weapp'
      ? typeof Taro.openBluetoothAdapter === 'function'
      : typeof bleAdapter.connectTargetDevice === 'function'
  const pairSheetDevices = useMemo<PairSheetBleOption[]>(
    () =>
      nearbyBleDevices.map((device) => {
        const normalizedUuid = device.uuid.trim().toUpperCase()
        const rememberedUuid = targetDeviceUuid.trim().toUpperCase()
        const isConnected =
          bleConnectionStatus === 'connected' &&
          bleCharacteristicStatus === 'ready' &&
          !!rememberedUuid &&
          normalizedUuid === rememberedUuid

        return {
          ...device,
          connected: isConnected,
          remembered: !!rememberedUuid && normalizedUuid === rememberedUuid,
          meta: isConnected
            ? `已连接设备 ${normalizedUuid}`
            : `附近发现的 BeadCraft 设备 ${normalizedUuid}`
        }
      }),
    [bleCharacteristicStatus, bleConnectionStatus, nearbyBleDevices, targetDeviceUuid]
  )
  const pairSheetStatusMessage = useMemo(() => {
    if (!bleAvailable) {
      return '当前小程序环境不支持蓝牙连接'
    }
    if (bleConnectionStatus === 'connecting' || isBleScanning) {
      return '正在搜索并连接附近的 BeadCraft 设备...'
    }
    if (
      bleConnectionStatus === 'connected' &&
      bleCharacteristicStatus === 'ready' &&
      targetDeviceUuid
    ) {
      return `已连接设备 ${targetDeviceUuid}`
    }
    if (pairSheetDevices.length > 0) {
      return `已发现 ${pairSheetDevices.length} 台 BeadCraft 设备，点一下即可连接`
    }
    if (bleConnectionStatus === 'error') {
      return '蓝牙连接失败，请重新扫描设备'
    }
    return '点击“添加设备”搜索附近的 BeadCraft 设备'
  }, [
    bleAvailable,
    bleCharacteristicStatus,
    bleConnectionStatus,
    isBleScanning,
    pairSheetDevices.length,
    targetDeviceUuid
  ])
  const pairSheetStatusTone: 'default' | 'ready' | 'connected' =
    bleConnectionStatus === 'connected' &&
    bleCharacteristicStatus === 'ready' &&
    targetDeviceUuid
      ? 'connected'
      : pairSheetDevices.length > 0
        ? 'ready'
        : 'default'

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
        v11
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
          {hasPattern ? (
            <View className='community-share-card'>
              <View className='community-share-card__header'>
                <View>
                  <Text className='community-share-card__title'>社区分享</Text>
                  <Text className='community-share-card__subtitle'>
                    决定这张图案是否同步到社区，当前历史 {historyEntries.length} 条
                  </Text>
                </View>
                <Switch
                  checked={autoShareToCommunity}
                  color='#2563eb'
                  onChange={(event) => {
                    setAutoShareToCommunity(Boolean(event.detail.value))
                  }}
                />
              </View>
              <View className='community-share-card__author'>
                <ProfileAvatar
                  nickname={userNickname}
                  seed={userAvatarSeed}
                  size='sm'
                />
                <View className='community-share-card__author-meta'>
                  <Text className='community-share-card__author-name'>{userNickname}</Text>
                  <Text className='community-share-card__author-hint'>
                    社区发布会使用当前昵称与默认头像
                  </Text>
                </View>
                <PatternThumb
                  colorSummary={colorSummary}
                  pixelMatrix={pixelMatrix}
                />
              </View>
              <Input
                className='community-share-card__input'
                value={shareTitle}
                placeholder='给这张图案起个名字'
                onInput={(event) => {
                  setShareTitle(event.detail.value)
                }}
              />
              <Textarea
                className='community-share-card__textarea'
                value={shareDescription}
                maxlength={120}
                placeholder='写一句作品说明，选填'
                onInput={(event) => {
                  setShareDescription(event.detail.value)
                }}
              />
              <View
                className={`community-share-card__button ${
                  isPublishing ? 'community-share-card__button--disabled' : ''
                }`}
                hoverClass='community-share-card__button--hover'
                hoverStayTime={40}
                onClick={() => {
                  if (isPublishing) {
                    return
                  }

                  void publishCurrentPattern().then(
                    () => {
                      showToast('当前图案已发布到社区')
                    },
                    (error) => {
                      showToast(error instanceof Error ? error.message : '社区发布失败')
                    }
                  )
                }}
              >
                <Text>{isPublishing ? '发布中...' : '发布当前作品'}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {currentEnv === 'weapp' ? (
        <Canvas
          id={LOCAL_GENERATION_CANVAS_ID}
          type='2d'
          className='local-generation-canvas'
        />
      ) : null}
      <PairSheet
        visible={isPairSheetOpen}
        bleAvailable={bleAvailable}
        bleConnectionStatus={bleConnectionStatus}
        statusMessage={pairSheetStatusMessage}
        statusTone={pairSheetStatusTone}
        devices={pairSheetDevices}
        isScanning={isBleScanning}
        onClose={handleClosePairSheet}
        onSelectDevice={handleSelectBleDevice}
        onAddDevice={handleAddBleDevice}
      />
      <SettingsSheet
        visible={isSettingsSheetOpen}
        onClose={handleCloseSettings}
        onExport={handleExport}
      />
      <ToastHost message={toastMessage} />
      <AppTabBar current='tool' />
    </View>
  )
}
