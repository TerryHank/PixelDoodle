import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import '@/styles/template-h5.scss'
import luoxiaoheiOriginal from '@/assets/examples/luoxiaohei_original.jpg'
import luoxiaoheiThumb from '@/assets/examples/luoxiaohei_thumb.png'
import meiliOriginal from '@/assets/examples/meili_original.jpg'
import meiliThumb from '@/assets/examples/meili_thumb.png'
import ponyOriginal from '@/assets/examples/pony_original.jpg'
import ponyThumb from '@/assets/examples/pony_thumb.png'
import usachiOriginal from '@/assets/examples/usachi_original.jpg'
import usachiThumb from '@/assets/examples/usachi_thumb.png'
import { bleAdapter } from '@/adapters/ble'
import type { BleKnownDevice } from '@/adapters/ble/types'
import { fileAdapter } from '@/adapters/file'
import { AppTabBar } from '@/components/app-tab-bar'
import { CropDialogH5 } from '@/components/crop-dialog/index.h5'
import { PairSheetH5, type PairSheetBleOption } from '@/components/pair-sheet/index.h5'
import { PatternThumb } from '@/components/pattern-thumb'
import { ProfileAvatar } from '@/components/profile-avatar'
import { SettingsSheetH5 } from '@/components/settings-sheet/index.h5'
import { ToastHost } from '@/components/toast-host'
import { autoSendGeneratedPattern } from '@/services/ble-image-sync'
import { publishCommunityPost } from '@/services/community-service'
import {
  exportPattern,
  type ExportKind
} from '@/services/pattern-service'
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
import {
  buildCanvasRenderModel,
  drawCanvasRenderModel,
  formatColorTotalText
} from './h5-canvas'
import { deriveH5HomeViewState, getBleConnectedToastMessage } from './h5-runtime'
import { hideLoadingSafely } from '@/utils/loading'

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const CANVAS_VIRTUAL_MAX_DIM = 640

function resolveH5DisplayMaxPatternDim() {
  if (typeof window === 'undefined') {
    return CANVAS_VIRTUAL_MAX_DIM
  }

  return Math.max(
    160,
    Math.min(CANVAS_VIRTUAL_MAX_DIM, Math.floor(window.innerWidth - 28))
  )
}

interface CropBoxState {
  x: number
  y: number
  size: number
}

interface CropState {
  file: File | null
  img: HTMLImageElement | null
  scale: number
  box: CropBoxState
  dragging: boolean
  startX: number
  startY: number
}

const EXAMPLE_ITEMS = [
  {
    id: 'luoxiaohei',
    title: 'Luo Xiaohei',
    thumbnailUrl: luoxiaoheiThumb,
    sourceUrl: luoxiaoheiOriginal
  },
  {
    id: 'meili',
    title: 'Meili',
    thumbnailUrl: meiliThumb,
    sourceUrl: meiliOriginal
  },
  {
    id: 'pony',
    title: 'Pony',
    thumbnailUrl: ponyThumb,
    sourceUrl: ponyOriginal
  },
  {
    id: 'usachi',
    title: 'Usachi',
    thumbnailUrl: usachiThumb,
    sourceUrl: usachiOriginal
  }
] as const

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

function getDifficultyValue(difficulty: number) {
  if (difficulty <= 0.0625) return '0.0625'
  if (difficulty <= 0.125) return '0.125'
  if (difficulty <= 0.25) return '0.25'
  return '1.0'
}

function getModeQuickPresentation(input: {
  targetDeviceUuid: string | null
  bleConnectedUuid: string | null
  isBleReady: boolean
}) {
  const targetUuid = input.targetDeviceUuid?.trim() || ''
  const connectedUuid = input.bleConnectedUuid?.trim() || ''
  const isConnected =
    input.isBleReady &&
    connectedUuid.length > 0 &&
    (!targetUuid || connectedUuid === targetUuid)

  return {
    connected: isConnected,
    label: isConnected ? connectedUuid.slice(0, 4) : '未连接'
  }
}

function getBgToggleStyle(removeBackground: boolean) {
  return removeBackground
    ? {
        borderStyle: 'dashed' as const,
        borderColor: '#999'
      }
    : {
        borderStyle: 'solid' as const,
        borderColor: '#333'
      }
}

export default function HomePageH5() {
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const cropStateRef = useRef<CropState>({
    file: null,
    img: null,
    scale: 1,
    box: { x: 0, y: 0, size: 0 },
    dragging: false,
    startX: 0,
    startY: 0
  })
  const [authorizedBleDevices, setAuthorizedBleDevices] = useState<BleKnownDevice[]>([])
  const [bleConnectedUuid, setBleConnectedUuid] = useState<string | null>(null)
  const [difficultyMode, setDifficultyMode] = useState('0.125')
  const [customPixelSize, setCustomPixelSize] = useState(8)
  const [cropImageUrl, setCropImageUrl] = useState('')
  const [cropImageStyle, setCropImageStyle] = useState<Record<string, string>>({})
  const [cropBoxStyle, setCropBoxStyle] = useState<Record<string, string>>({})
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false)
  const [shareTitle, setShareTitle] = useState('')
  const [shareDescription, setShareDescription] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)

  useEffect(() => {
    document.title = 'BeadCraft - Perler Bead Pattern Generator'
  }, [])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const cropState = cropStateRef.current
      if (!cropState.dragging || !cropState.img) {
        return
      }

      let nextX = (event.clientX - cropState.startX) / cropState.scale
      let nextY = (event.clientY - cropState.startY) / cropState.scale
      nextX = Math.max(0, Math.min(nextX, cropState.img.width - cropState.box.size))
      nextY = Math.max(0, Math.min(nextY, cropState.img.height - cropState.box.size))
      cropState.box = {
        ...cropState.box,
        x: nextX,
        y: nextY
      }
      updateCropBox()
    }

    const handleMouseUp = () => {
      cropStateRef.current.dragging = false
    }

    const handleTouchMove = (event: TouchEvent) => {
      const cropState = cropStateRef.current
      if (!cropState.dragging || !cropState.img || !event.touches.length) {
        return
      }

      const touch = event.touches[0]
      let nextX = (touch.clientX - cropState.startX) / cropState.scale
      let nextY = (touch.clientY - cropState.startY) / cropState.scale
      nextX = Math.max(0, Math.min(nextX, cropState.img.width - cropState.box.size))
      nextY = Math.max(0, Math.min(nextY, cropState.img.height - cropState.box.size))
      cropState.box = {
        ...cropState.box,
        x: nextX,
        y: nextY
      }
      updateCropBox()
    }

    const handleTouchEnd = () => {
      cropStateRef.current.dragging = false
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove)
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  const pixelMatrix = usePatternStore((state) => state.pixelMatrix)
  const colorSummary = usePatternStore((state) => state.colorSummary)
  const fullPalette = usePatternStore((state) => state.fullPalette)
  const fullPaletteList = usePatternStore((state) => state.fullPaletteList)
  const gridSize = usePatternStore((state) => state.gridSize)
  const totalBeads = usePatternStore((state) => state.totalBeads)
  const removeBackground = usePatternStore((state) => state.removeBackground)
  const ledSize = usePatternStore((state) => state.ledSize)
  const difficulty = usePatternStore((state) => state.difficulty)
  const isGenerating = usePatternStore((state) => state.isGenerating)
  const targetDeviceUuid = useDeviceStore((state) => state.targetDeviceUuid)
  const bleConnectionStatus = useDeviceStore((state) => state.bleConnectionStatus)
  const bleCharacteristicStatus = useDeviceStore((state) => state.bleCharacteristicStatus)
  const activeHighlightCodes = useDeviceStore((state) => state.activeHighlightCodes)
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
    if (
      bleConnectedUuid &&
      targetDeviceUuid &&
      bleConnectedUuid !== targetDeviceUuid
    ) {
      setBleConnectedUuid(null)
    }
  }, [bleConnectedUuid, targetDeviceUuid])

  useEffect(() => {
    if (!isPairSheetOpen) {
      return
    }

    void refreshBleDevices()
  }, [isPairSheetOpen, bleConnectedUuid, targetDeviceUuid])

  useEffect(() => {
    if (difficultyMode === 'custom') {
      return
    }

    setDifficultyMode(getDifficultyValue(difficulty))
  }, [difficulty, difficultyMode])

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

  function updateCropBox() {
    const cropState = cropStateRef.current
    setCropBoxStyle({
      left: `${cropState.box.x * cropState.scale}px`,
      top: `${cropState.box.y * cropState.scale}px`,
      width: `${cropState.box.size * cropState.scale}px`,
      height: `${cropState.box.size * cropState.scale}px`
    })
  }

  function resetCropState() {
    cropStateRef.current = {
      file: null,
      img: null,
      scale: 1,
      box: { x: 0, y: 0, size: 0 },
      dragging: false,
      startX: 0,
      startY: 0
    }
    setCropImageStyle({})
    setCropBoxStyle({})
    setCropImageUrl('')
  }

  function getCropViewportBounds() {
    const isCompactViewport = window.innerWidth <= 768
    const horizontalInset = isCompactViewport ? 56 : 128
    const verticalInset = isCompactViewport ? 300 : 240

    return {
      maxWidth: Math.max(220, window.innerWidth - horizontalInset),
      maxHeight: Math.max(220, window.innerHeight - verticalInset)
    }
  }

  function cancelCrop() {
    setIsCropDialogOpen(false)
    resetCropState()
  }

  function validateSelectedFile(file: File) {
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      showToast('仅支持 JPG、PNG、GIF、WebP')
      return false
    }

    if (file.size > 20 * 1024 * 1024) {
      showToast('图片大小不能超过 20MB')
      return false
    }

    return true
  }

  function showCropDialog(file: File) {
    cropStateRef.current.file = file

    const reader = new FileReader()
    reader.onload = (event) => {
      const imageUrl = String(event.target?.result || '')
      const image = new Image()
      image.onload = () => {
        cropStateRef.current.img = image
        const { maxWidth, maxHeight } = getCropViewportBounds()
        cropStateRef.current.scale = Math.min(
          maxWidth / image.width,
          maxHeight / image.height,
          1
        )
        const renderedWidth = Math.max(
          1,
          Math.round(image.width * cropStateRef.current.scale)
        )
        const renderedHeight = Math.max(
          1,
          Math.round(image.height * cropStateRef.current.scale)
        )

        const minDimension = Math.min(image.width, image.height)
        cropStateRef.current.box = {
          x: (image.width - minDimension) / 2,
          y: (image.height - minDimension) / 2,
          size: minDimension
        }

        setCropImageStyle({
          width: `${renderedWidth}px`,
          height: `${renderedHeight}px`
        })
        setCropImageUrl(imageUrl)
        updateCropBox()
        setIsCropDialogOpen(true)
      }
      image.src = imageUrl
    }
    reader.readAsDataURL(file)
  }

  function handleUploadFileSelection(file: File | null) {
    if (!file) {
      return
    }

    if (!validateSelectedFile(file)) {
      return
    }

    showCropDialog(file)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function confirmCrop() {
    const cropState = cropStateRef.current
    const image = cropState.img
    const file = cropState.file

    if (!image || !file || !cropState.box.size) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = cropState.box.size
    canvas.height = cropState.box.size
    const context = canvas.getContext('2d')

    if (!context) {
      showToast('裁剪失败')
      return
    }

    context.drawImage(
      image,
      cropState.box.x,
      cropState.box.y,
      cropState.box.size,
      cropState.box.size,
      0,
      0,
      cropState.box.size,
      cropState.box.size
    )

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95)
    })

    if (!blob) {
      showToast('裁剪失败')
      return
    }

    const croppedFile = new File([blob], file.name, { type: 'image/jpeg' })
    const croppedUrl = URL.createObjectURL(croppedFile)
    cancelCrop()
    usePatternStore.setState({ exampleImage: null, isGenerating: true })
    await runGenerate(croppedUrl, croppedFile.name)
  }

  function getGenerateOverrides() {
    if (difficultyMode === 'custom') {
      return {
        mode: 'pixel_size' as const,
        pixelSize: customPixelSize
      }
    }

    return {
      mode: 'fixed_grid' as const
    }
  }

  async function runGenerate(filePath: string, fileName?: string) {
    Taro.showLoading({
      title: '生成中...'
    })

    try {
      const response = await usePatternStore.getState().generateFromFile(filePath, {
        fileName,
        ...getGenerateOverrides()
      })
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
      await hideLoadingSafely(() => Taro.hideLoading())
    }
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

  async function handleSelectExample(item: (typeof EXAMPLE_ITEMS)[number]) {
    Taro.showLoading({
      title: '载入示例...'
    })

    try {
      usePatternStore.setState({
        exampleImage: item.id,
        isGenerating: true
      })

      const response = await Taro.downloadFile({
        url: item.sourceUrl
      })

      if (response.statusCode >= 400 || !response.tempFilePath) {
        throw new Error('示例图片加载失败')
      }

      await runGenerate(response.tempFilePath, `${item.id}_original.jpg`)
    } catch (error) {
      usePatternStore.setState({
        isGenerating: false
      })
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

  async function handleChangeLedSize(nextLedSize: number) {
    if (!Number.isFinite(nextLedSize) || nextLedSize <= 0) {
      return
    }

    usePatternStore.getState().setLedSize(nextLedSize)

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

  async function handleChangeDifficulty(nextDifficultyValue: string) {
    setDifficultyMode(nextDifficultyValue)

    if (nextDifficultyValue === 'custom') {
      return
    }

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

  function handleCustomPixelSizeInput(nextValue: string) {
    const parsed = Number.parseInt(nextValue, 10)
    if (!Number.isFinite(parsed) || parsed < 4 || parsed > 32) {
      return
    }

    setCustomPixelSize(parsed)
  }

  async function handleCustomSliderRelease() {
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
    const nextRemoveBackground = !store.removeBackground
    store.toggleRemoveBackground()

    if (!store.originalImage) {
      showToast(nextRemoveBackground ? '已开启自动去背' : '已关闭自动去背')
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
    if (typeof bleAdapter.getAuthorizedDevices !== 'function') {
      setAuthorizedBleDevices([])
      return []
    }

    try {
      const devices = await bleAdapter.getAuthorizedDevices()
      setAuthorizedBleDevices(devices)
      return devices
    } catch (error) {
      console.warn('Failed to load authorized Bluetooth devices:', error)
      setAuthorizedBleDevices([])
      return []
    }
  }

  async function handleOpenPairSheet() {
    useUIStore.setState({
      isPairSheetOpen: true
    })
    await refreshBleDevices()
  }

  function handleClosePairSheet() {
    useUIStore.setState({
      isPairSheetOpen: false
    })
  }

  async function completeBleConnectionFlow(connectedUuid: string | null) {
    const normalizedUuid = connectedUuid?.trim().toUpperCase() || ''
    if (!normalizedUuid) {
      throw new Error('蓝牙连接成功，但设备 UUID 为空')
    }

    useDeviceStore.getState().setTargetDeviceUuid(normalizedUuid)
    useDeviceStore.getState().setBleConnectionStatus('connected')
    useDeviceStore.getState().setBleCharacteristicStatus('ready')
    setBleConnectedUuid(normalizedUuid)
    useUIStore.setState({
      isPairSheetOpen: false
    })
    await refreshBleDevices()
    showToast(
      getBleConnectedToastMessage({
        targetDeviceUuid: normalizedUuid,
        bleConnectedUuid: normalizedUuid
      })
    )
  }

  async function handleBleConnection(connect: () => Promise<string | null>) {
    useDeviceStore.getState().setBleConnectionStatus('connecting')
    useDeviceStore.getState().setBleCharacteristicStatus('discovering')

    try {
      const connectedUuid = await connect()
      await completeBleConnectionFlow(connectedUuid)
    } catch (error) {
      const isCancelled = error instanceof Error && error.name === 'NotFoundError'
      useDeviceStore.getState().setBleConnectionStatus(isCancelled ? 'idle' : 'error')
      useDeviceStore.getState().setBleCharacteristicStatus(isCancelled ? 'idle' : 'error')
      setBleConnectedUuid(null)
      await refreshBleDevices()
      if (!isCancelled) {
        showToast(error instanceof Error ? error.message : '蓝牙连接失败')
      }
    }
  }

  async function handleConnectKnownBleDevice(deviceKey: string) {
    await handleBleConnection(async () => {
      if (typeof bleAdapter.connectKnownDevice === 'function') {
        return await bleAdapter.connectKnownDevice(deviceKey)
      }
      return await bleAdapter.connectTargetDevice()
    })
  }

  async function handleAddBleDevice() {
    await handleBleConnection(async () => {
      if (typeof bleAdapter.addTargetDevice === 'function') {
        return await bleAdapter.addTargetDevice()
      }
      return await bleAdapter.connectTargetDevice()
    })
  }

  function handleSelectPairDevice(deviceKey: string) {
    const device = pairSheetDevices.find((item) => item.key === deviceKey)
    if (device?.requiresPairing) {
      void handleAddBleDevice()
      return
    }
    void handleConnectKnownBleDevice(deviceKey)
  }

  async function handleCycleConnectionMode() {
    const devices = await refreshBleDevices()
    if (isBleReady && bleConnectedUuid) {
      await handleOpenPairSheet()
      return
    }
    if (devices.length === 0) {
      await handleAddBleDevice()
      return
    }
    await handleOpenPairSheet()
  }

  async function handleToggleColor(code: string) {
    const nextCodes = useDeviceStore.getState().toggleHighlightCode(code)
    const highlightRgb = nextCodes
      .map((itemCode) => colorSummary.find((item) => item.code === itemCode)?.rgb)
      .filter((rgb): rgb is [number, number, number] => Array.isArray(rgb))

    try {
      if (
        bleConnectionStatus === 'connected' &&
        bleCharacteristicStatus === 'ready'
      ) {
        await bleAdapter.sendHighlight(highlightRgb)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '颜色高亮同步失败')
    }
  }

  const hasPattern = hasGeneratedPattern(pixelMatrix)
  const isRestoringGeneratedState = isGenerating && !hasPattern
  const bgToggleStyle = useMemo(
    () => getBgToggleStyle(removeBackground),
    [removeBackground]
  )
  const isBleReady =
    bleConnectionStatus === 'connected' && bleCharacteristicStatus === 'ready'
  const bleAvailable =
    typeof navigator !== 'undefined' && !!navigator.bluetooth
  const homeViewState = useMemo(
    () =>
      deriveH5HomeViewState({
        targetDeviceUuid: targetDeviceUuid || null,
        bleConnectedUuid,
        isBleReady,
        hasPattern,
        connectionMode: 'ble'
      }),
    [bleConnectedUuid, hasPattern, isBleReady, targetDeviceUuid]
  )
  const modeQuick = useMemo(
    () =>
      getModeQuickPresentation({
        targetDeviceUuid: targetDeviceUuid || null,
        bleConnectedUuid,
        isBleReady
      }),
    [bleConnectedUuid, isBleReady, targetDeviceUuid]
  )
  const pairSheetDevices = useMemo<PairSheetBleOption[]>(() => {
    const connectedUuid = bleConnectedUuid?.trim().toUpperCase() || ''
    const rememberedUuid = targetDeviceUuid?.trim().toUpperCase() || ''
    const items = authorizedBleDevices.map((device) => {
      const deviceUuid = device.uuid.trim().toUpperCase()
      const isConnected = isBleReady && !!connectedUuid && deviceUuid === connectedUuid
      const isRemembered = !!rememberedUuid && deviceUuid === rememberedUuid

      return {
        ...device,
        connected: isConnected,
        remembered: isRemembered,
        meta: isConnected
          ? `已连接设备 ${connectedUuid}`
          : isRemembered
            ? `已记住设备 ${deviceUuid}`
            : '已授权 BeadCraft 设备'
      }
    })

    if (
      rememberedUuid &&
      !items.some((item) => item.uuid.trim().toUpperCase() === rememberedUuid)
    ) {
      items.push({
        key: `remembered-${rememberedUuid}`,
        name: `BeadCraft-${rememberedUuid}`,
        uuid: rememberedUuid,
        connected: false,
        remembered: true,
        requiresPairing: true,
        meta: `已记住设备 ${rememberedUuid}，需重新授权`
      })
    }

    return items
  }, [authorizedBleDevices, bleConnectedUuid, isBleReady, targetDeviceUuid])
  const pairSheetStatusMessage = useMemo(() => {
    if (!bleAvailable) {
      return '当前浏览器不支持 Web Bluetooth'
    }
    if (bleConnectionStatus === 'connecting') {
      return '正在连接蓝牙设备...'
    }
    if (bleConnectionStatus === 'error') {
      return '蓝牙连接失败，请重试'
    }
    if (isBleReady && bleConnectedUuid) {
      return `已连接设备 ${bleConnectedUuid}`
    }
    if (authorizedBleDevices.length > 0) {
      return `已授权设备 ${authorizedBleDevices.length} 台，可直接点击连接`
    }
    return '还没有已授权的 BeadCraft 设备，点“添加设备”进行首次连接。'
  }, [authorizedBleDevices.length, bleAvailable, bleConnectedUuid, bleConnectionStatus, isBleReady])
  const pairSheetStatusTone: 'default' | 'ready' | 'connected' = isBleReady && bleConnectedUuid
    ? 'connected'
    : authorizedBleDevices.length > 0
      ? 'ready'
      : 'default'

  const canvasRenderModel = useMemo(() => {
    if (!hasPattern) {
      return null
    }

    return buildCanvasRenderModel({
      gridWidth: gridSize.width || pixelMatrix[0]?.length || 0,
      gridHeight: gridSize.height || pixelMatrix.length,
      activeCodes: new Set(activeHighlightCodes),
      pixelMatrix,
      maxPatternDim: CANVAS_VIRTUAL_MAX_DIM,
      displayMaxPatternDim: resolveH5DisplayMaxPatternDim()
    })
  }, [activeHighlightCodes, gridSize.height, gridSize.width, hasPattern, pixelMatrix])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvasRenderModel) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    canvas.width = canvasRenderModel.canvasWidth
    canvas.height = canvasRenderModel.canvasHeight

    const colorLookup = colorSummary.reduce<Record<string, string>>((accumulator, item) => {
      accumulator[item.code] = item.hex
      return accumulator
    }, {})

    Object.entries(fullPalette).forEach(([code, item]) => {
      if (!colorLookup[code]) {
        colorLookup[code] = item.hex
      }
    })

    drawCanvasRenderModel({
      context,
      model: canvasRenderModel,
      colorLookup
    })
  }, [canvasRenderModel, colorSummary, fullPalette])

  return (
    <div className='template-home-page'>
      <div className='site-version-badge'>v11</div>
      <div className='main-container'>
        <div id='result-area' className='result-area'>
          <div className='canvas-toolbar'>
            <button
              id='clear-btn'
              className='toolbar-btn'
              onClick={handleClear}
              title='回到主页'
              type='button'
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <path d='M3 10.5 12 3l9 7.5' />
                <path d='M5 9.5V21h14V9.5' />
                <path d='M9 21v-6h6v6' />
              </svg>
            </button>
            <button
              id='bg-toggle'
              className='toolbar-btn'
              style={bgToggleStyle}
              onClick={() => void handleToggleBackground()}
              title='自动去除背景'
              type='button'
            >
              背
            </button>
            <label
              id='upload-btn'
              className='toolbar-btn'
              htmlFor='file-input'
              title='上传'
            >
              <span className='toolbar-btn-icon'>+</span>
            </label>
            <input
              id='file-input'
              className='hidden-input'
              type='file'
              accept='image/jpeg,image/png,image/gif,image/webp'
              ref={fileInputRef}
              onChange={(event) => handleUploadFileSelection(event.target.files?.[0] ?? null)}
            />
            <select
              id='difficulty-select'
              className='led-size-btn'
              title='难度'
              value={getDifficultyValue(difficulty)}
              onChange={(event) => void handleChangeDifficulty(event.target.value)}
            >
              <option value='1.0'>原</option>
              <option value='0.25'>难</option>
              <option value='0.125'>中</option>
              <option value='0.0625'>易</option>
              <option value='custom'>自</option>
            </select>
            <select
              id='led-matrix-size'
              className='led-size-btn'
              value={String(ledSize)}
              onChange={(event) => void handleChangeLedSize(Number.parseInt(event.target.value, 10))}
            >
              <option value='16'>16</option>
              <option value='32'>32</option>
              <option value='52'>52</option>
              <option value='64'>64</option>
            </select>
            <button
              id='mode-quick-btn'
              className={`toolbar-btn mode-quick-btn ${modeQuick.connected ? 'mode-quick-btn--connected' : 'mode-quick-btn--disconnected'}`}
              onClick={handleCycleConnectionMode}
              title='蓝牙连接'
              type='button'
            >
              {modeQuick.label}
            </button>
            <button
              id='export-btn'
              className='toolbar-btn'
              onClick={handleOpenSettings}
              title='导出'
              type='button'
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <path d='M12 3v12' />
                <path d='m7 10 5 5 5-5' />
                <path d='M5 21h14' />
              </svg>
            </button>
          </div>

          <div className='canvas-container' style={{ margin: '0 auto', position: 'relative' }}>
            {homeViewState.showUploadArea && !isRestoringGeneratedState ? (
              <label
                id='upload-area'
                className={homeViewState.uploadAreaClassName}
                htmlFor='file-input'
              >
              <div className='upload-area-icon'>{homeViewState.uploadAreaIcon}</div>
              <div className='upload-area-text'>{homeViewState.uploadAreaText}</div>
              <div className='upload-area-hint'>{homeViewState.uploadAreaHint}</div>
            </label>
          ) : (
              <div className='preview-section'>
                <canvas
                  id='pattern-canvas'
                  ref={canvasRef}
                  style={
                    canvasRenderModel
                      ? {
                          display: 'block',
                          width: `${canvasRenderModel.displayWidth}px`,
                          height: `${canvasRenderModel.displayHeight}px`
                        }
                      : { display: 'none' }
                  }
                />
              </div>
            )}
          </div>

          {homeViewState.showExamples && !isRestoringGeneratedState ? (
            <div
              id='examples-container'
              className='section examples-section'
              style={{ marginTop: '12px' }}
            >
              <div className='section-title' data-i18n='examples.title'>
                示例图片
              </div>
              <div className='examples-gallery'>
                {EXAMPLE_ITEMS.map((item) => (
                  <div
                    key={item.id}
                    className='example-item'
                    onClick={() => void handleSelectExample(item)}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      className='example-thumb'
                    />
                    <div className='example-name'>{item.title}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div
            id='color-panel'
            className='color-panel'
            style={{
              display:
                homeViewState.showColorPanel && colorSummary.length ? 'flex' : 'none',
              flexDirection: 'column',
              alignItems: 'flex-start'
            }}
          >
            <div
              id='custom-slider-container'
              style={{
                display: difficultyMode === 'custom' ? 'block' : 'none',
                position: 'relative',
                width: '640px',
                marginBottom: '8px'
              }}
            >
              <input
                id='custom-pixel-slider'
                type='range'
                min='4'
                max='32'
                value={String(customPixelSize)}
                style={{ width: '100%', height: '4px' }}
                onChange={(event) => handleCustomPixelSizeInput(event.target.value)}
                onMouseUp={() => void handleCustomSliderRelease()}
                onTouchEnd={() => void handleCustomSliderRelease()}
              />
              <span
                id='custom-pixel-value'
                style={{
                  position: 'absolute',
                  top: '-18px',
                  left: `${((customPixelSize - 4) / 28) * 100}%`,
                  fontSize: '12px',
                  transform: 'translateX(-50%)',
                  pointerEvents: 'none'
                }}
              >
                {customPixelSize}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%' }}>
              <div id='color-list' className='color-list'>
                {colorSummary.map((item) => (
                  <div
                    key={item.code}
                    className={`color-tag ${activeHighlightCodes.includes(item.code) ? 'active' : ''}`}
                    data-code={item.code}
                    title={`${item.name} (${item.code})`}
                    onClick={() => void handleToggleColor(item.code)}
                  >
                    <span className='color-swatch' style={{ background: item.hex }} />
                  </div>
                ))}
              </div>
              <div id='color-total' className='color-total'>
                {formatColorTotalText(colorSummary.length, totalBeads)}
              </div>
            </div>
          </div>

          {hasPattern ? (
            <div className='community-share-card'>
              <div className='community-share-card__header'>
                <div>
                  <div className='community-share-card__title'>社区分享</div>
                  <div className='community-share-card__subtitle'>
                    决定这张图案是否同步到社区，当前历史 {historyEntries.length} 条
                  </div>
                </div>
                <label className='community-share-card__toggle'>
                  <input
                    checked={autoShareToCommunity}
                    type='checkbox'
                    onChange={(event) => {
                      setAutoShareToCommunity(event.target.checked)
                    }}
                  />
                  <span>{autoShareToCommunity ? '已开启' : '未开启'}</span>
                </label>
              </div>
              <div className='community-share-card__author'>
                <ProfileAvatar
                  nickname={userNickname}
                  seed={userAvatarSeed}
                  size='sm'
                />
                <div className='community-share-card__author-meta'>
                  <div className='community-share-card__author-name'>{userNickname}</div>
                  <div className='community-share-card__author-hint'>
                    社区发布会使用当前昵称与默认头像
                  </div>
                </div>
                <PatternThumb
                  colorSummary={colorSummary}
                  pixelMatrix={pixelMatrix}
                />
              </div>
              <input
                className='community-share-card__input'
                placeholder='给这张图案起个名字'
                type='text'
                value={shareTitle}
                onChange={(event) => {
                  setShareTitle(event.target.value)
                }}
              />
              <textarea
                className='community-share-card__textarea'
                maxLength={120}
                placeholder='写一句作品说明，选填'
                value={shareDescription}
                onChange={(event) => {
                  setShareDescription(event.target.value)
                }}
              />
              <button
                className={`community-share-card__button ${
                  isPublishing ? 'community-share-card__button--disabled' : ''
                }`}
                type='button'
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
                {isPublishing ? '发布中...' : '发布当前作品'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <PairSheetH5
        open={isPairSheetOpen}
        statusMessage={pairSheetStatusMessage}
        statusTone={pairSheetStatusTone}
        bleAvailable={bleAvailable}
        devices={pairSheetDevices}
        onClose={handleClosePairSheet}
        onSelectDevice={handleSelectPairDevice}
        onAddDevice={() => void handleAddBleDevice()}
      />
      <SettingsSheetH5
        open={isSettingsSheetOpen}
        onClose={handleCloseSettings}
        onExport={handleExport}
      />
      <div id='serial-toast' className='serial-toast' style={{ display: 'none' }} />
      <CropDialogH5
        open={isCropDialogOpen}
        imageUrl={cropImageUrl}
        cropImageRef={cropImageRef}
        cropImageStyle={cropImageStyle}
        cropBoxStyle={cropBoxStyle}
        onCancel={cancelCrop}
        onConfirm={() => void confirmCrop()}
        onMouseDown={(event) => {
          event.preventDefault()
          const cropState = cropStateRef.current
          cropState.dragging = true
          cropState.startX = event.clientX - cropState.box.x * cropState.scale
          cropState.startY = event.clientY - cropState.box.y * cropState.scale
        }}
        onTouchStart={(event) => {
          event.preventDefault()
          const touch = event.touches[0]
          if (!touch) {
            return
          }
          const cropState = cropStateRef.current
          cropState.dragging = true
          cropState.startX = touch.clientX - cropState.box.x * cropState.scale
          cropState.startY = touch.clientY - cropState.box.y * cropState.scale
        }}
      />
      <ToastHost message={toastMessage} />
      <AppTabBar current='tool' />
    </div>
  )
}
