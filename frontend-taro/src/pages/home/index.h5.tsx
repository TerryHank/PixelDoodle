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
import { DeviceMonitorPanel } from '@/components/device-monitor-panel'
import { PairSheetH5, type PairSheetBleOption } from '@/components/pair-sheet/index.h5'
import { PatternThumb } from '@/components/pattern-thumb'
import { ProfileAvatar } from '@/components/profile-avatar'
import { SettingsSheetH5 } from '@/components/settings-sheet/index.h5'
import { ToastHost } from '@/components/toast-host'
import { PixelEditorH5 } from '@/features/pixel-editor/index.h5'
import { GENERATION_STYLES } from '@/constants/generation-styles'
import {
  BOARD_SIZE_OPTIONS,
  buildPixelColorSummary,
  countPlacedBeads,
  createEmptyPixelMatrix,
  getBoardSize,
  resizePixelMatrix
} from '@/features/pixel-editor/model'
import {
  clampCropRect,
  createAspectCropRect,
  zoomCropRect,
  type CropRect
} from '@/features/image-calibration/model'
import { autoSendGeneratedPattern } from '@/services/ble-image-sync'
import { publishCommunityPost } from '@/services/community-service'
import { consumePendingCloudWorkEdit } from '@/services/cloud-work-edit'
import {
  buildPrivateCloudCanvasDocument,
  createPrivateCloudWork,
  updatePrivateCloudWork
} from '@/services/private-cloud-service'
import {
  acknowledgeDeviceAlert,
  reportBleAck,
  reportBleNack,
  reportBleTimeout,
  reportDeviceConnection,
  reportDeviceHeartbeat,
  startDeviceOfflineMonitor
} from '@/services/device-monitoring-service'
import {
  applyMaterialPatternImport,
  consumePendingMaterialImport
} from '@/services/material-pattern-import'
import {
  exportPattern,
  type ExportKind
} from '@/services/pattern-service'
import { useDeviceStore } from '@/store/device-store'
import { useDeviceMonitorStore } from '@/store/device-monitor-store'
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
  formatColorTotalText
} from './h5-canvas'
import { deriveH5HomeViewState, getBleConnectedToastMessage } from './h5-runtime'
import { hideLoadingSafely } from '@/utils/loading'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const LOCAL_DRAFT_STORAGE_KEY = 'pixeldoodle:pixel-editor-draft'
const LOCAL_GENERATION_MODE = 'local'
let ownedOriginalImageUrl: string | null = null

type StyleTransferMode = 'none' | 'wanxiang'

interface PixelEditorDraft {
  version: 1
  title: string
  updatedAt: string
  boardSize: {
    width: number
    height: number
  }
  palettePreset: string
  pixelMatrix: Array<Array<string | null>>
  cloudWork?: {
    id: string
    version: number
  } | null
  cloudSynced?: boolean
}

function readPixelEditorDraft() {
  const draft = readPersistedState<PixelEditorDraft | null>(
    LOCAL_DRAFT_STORAGE_KEY,
    null
  )

  if (
    draft?.version !== 1 ||
    !Array.isArray(draft.pixelMatrix) ||
    draft.pixelMatrix.length === 0 ||
    !draft.pixelMatrix.every((row) => Array.isArray(row))
  ) {
    return null
  }

  return draft
}

interface CropState {
  file: File | null
  img: HTMLImageElement | null
  scale: number
  baseBox: CropRect
  box: CropRect
  zoom: number
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
  const lastAlertToastRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const imageOperationOwnerRef = useRef<symbol | null>(null)
  const cropStateRef = useRef<CropState>({
    file: null,
    img: null,
    scale: 1,
    baseBox: { x: 0, y: 0, width: 0, height: 0 },
    box: { x: 0, y: 0, width: 0, height: 0 },
    zoom: 1,
    dragging: false,
    startX: 0,
    startY: 0
  })
  const [authorizedBleDevices, setAuthorizedBleDevices] = useState<BleKnownDevice[]>([])
  const [bleConnectedUuid, setBleConnectedUuid] = useState<string | null>(null)
  const [difficultyMode, setDifficultyMode] = useState('0.25')
  const [styleTransferMode, setStyleTransferMode] = useState<StyleTransferMode>('none')
  const [customPixelSize, setCustomPixelSize] = useState(8)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropImageUrl, setCropImageUrl] = useState('')
  const [cropImageStyle, setCropImageStyle] = useState<Record<string, string>>({})
  const [cropBoxStyle, setCropBoxStyle] = useState<Record<string, string>>({})
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false)
  const [shareTitle, setShareTitle] = useState('')
  const [shareDescription, setShareDescription] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [isCloudSaving, setIsCloudSaving] = useState(false)
  const [cloudWork, setCloudWork] = useState<PixelEditorDraft['cloudWork']>(
    () => readPixelEditorDraft()?.cloudWork ?? null
  )
  const [isCloudSynced, setIsCloudSynced] = useState(() => {
    const draft = readPixelEditorDraft()
    return Boolean(draft?.cloudWork && draft.cloudSynced !== false)
  })
  const [hasLocalDraft, setHasLocalDraft] = useState(
    () => readPixelEditorDraft() !== null
  )

  useEffect(() => {
    document.title = 'PixelDoodle - 拼豆像素创作工作台'
  }, [])

  useEffect(() => {
    const pendingCloudWork = consumePendingCloudWorkEdit()
    if (pendingCloudWork) {
      const { document } = pendingCloudWork
      usePatternStore.getState().setBoardSize(document.grid_size)
      usePatternStore.setState({
        originalImage: null,
        generatedImage: null,
        exampleImage: null,
        pixelMatrix: document.pixel_matrix,
        gridSize: document.grid_size,
        colorSummary: document.color_summary,
        totalBeads: document.total_beads,
        palettePreset: document.palette_preset,
        sessionId: `cloud-${pendingCloudWork.id}`
      })
      const revision = {
        id: pendingCloudWork.id,
        version: pendingCloudWork.version
      }
      setShareTitle(pendingCloudWork.title)
      setCloudWork(revision)
      setIsCloudSynced(true)
      persistEditorDraft(
        document.pixel_matrix,
        pendingCloudWork.title,
        revision,
        true
      )
      showToast(`已打开云端作品：${pendingCloudWork.title}`)
      return
    }

    const pendingMaterial = consumePendingMaterialImport()
    if (!pendingMaterial) {
      return
    }

    applyMaterialPatternImport(pendingMaterial)
    setShareTitle(pendingMaterial.title)
    setCloudWork(null)
    setIsCloudSynced(false)
    persistEditorDraft(pendingMaterial.pixelMatrix, pendingMaterial.title, null, false)
    showToast(`已套用素材：${pendingMaterial.title}`)
  }, [])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const cropState = cropStateRef.current
      if (!cropState.dragging || !cropState.img) {
        return
      }

      const nextX = (event.clientX - cropState.startX) / cropState.scale
      const nextY = (event.clientY - cropState.startY) / cropState.scale
      cropState.box = clampCropRect(
        { ...cropState.box, x: nextX, y: nextY },
        cropState.img.width,
        cropState.img.height
      )
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
      const nextX = (touch.clientX - cropState.startX) / cropState.scale
      const nextY = (touch.clientY - cropState.startY) / cropState.scale
      cropState.box = clampCropRect(
        { ...cropState.box, x: nextX, y: nextY },
        cropState.img.width,
        cropState.img.height
      )
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
  const fullPaletteList = usePatternStore((state) => state.fullPaletteList)
  const presets = usePatternStore((state) => state.presets)
  const palettePreset = usePatternStore((state) => state.palettePreset)
  const boardSize = usePatternStore((state) => state.boardSize)
  const totalBeads = usePatternStore((state) => state.totalBeads)
  const originalImage = usePatternStore((state) => state.originalImage)
  const styleIndex = usePatternStore((state) => state.styleIndex)
  const removeBackground = usePatternStore((state) => state.removeBackground)
  const difficulty = usePatternStore((state) => state.difficulty)
  const isGenerating = usePatternStore((state) => state.isGenerating)
  const targetDeviceUuid = useDeviceStore((state) => state.targetDeviceUuid)
  const bleConnectionStatus = useDeviceStore((state) => state.bleConnectionStatus)
  const bleCharacteristicStatus = useDeviceStore((state) => state.bleCharacteristicStatus)
  const activeHighlightCodes = useDeviceStore((state) => state.activeHighlightCodes)
  const historyEntries = useHistoryStore((state) => state.entries)
  const monitoredDevices = useDeviceMonitorStore((state) => state.devices)
  const deviceAlerts = useDeviceMonitorStore((state) => state.alerts)
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

  function replaceOwnedOriginalImageUrl(nextUrl: string | null) {
    const previousUrl = ownedOriginalImageUrl
    if (previousUrl && previousUrl !== nextUrl) {
      URL.revokeObjectURL(previousUrl)
    }
    ownedOriginalImageUrl = nextUrl
  }

  function persistEditorDraft(
    nextMatrix: Array<Array<string | null>>,
    title = shareTitle,
    nextCloudWork = cloudWork,
    nextCloudSynced = isCloudSynced
  ) {
    const currentState = usePatternStore.getState()
    const draft: PixelEditorDraft = {
      version: 1,
      title: sanitizePatternTitle(title || '未命名作品'),
      updatedAt: new Date().toISOString(),
      boardSize: currentState.boardSize,
      palettePreset: currentState.palettePreset,
      pixelMatrix: nextMatrix,
      cloudWork: nextCloudWork,
      cloudSynced: nextCloudSynced
    }
    const saved = writePersistedState(LOCAL_DRAFT_STORAGE_KEY, draft)
    setHasLocalDraft(saved)
    return saved
  }

  function syncEditedPattern(nextMatrix: Array<Array<string | null>>) {
    const summary = buildPixelColorSummary(nextMatrix, fullPaletteList)
    usePatternStore.setState((state) => ({
      pixelMatrix: nextMatrix,
      colorSummary: summary,
      gridSize: {
        width: nextMatrix[0]?.length ?? state.boardSize.width,
        height: nextMatrix.length || state.boardSize.height
      },
      totalBeads: countPlacedBeads(nextMatrix),
      previewImage: null,
      sessionId: state.sessionId || `local-edit-${Date.now()}`
    }))
    setIsCloudSynced(false)
    persistEditorDraft(nextMatrix, shareTitle, cloudWork, false)
  }

  function handleCreateBlankCanvas() {
    const currentState = usePatternStore.getState()
    const nextMatrix = createEmptyPixelMatrix(
      currentState.boardSize.width,
      currentState.boardSize.height
    )
    usePatternStore.getState().clear()
    usePatternStore.setState({
      pixelMatrix: nextMatrix,
      gridSize: currentState.boardSize,
      totalBeads: 0,
      colorSummary: [],
      sessionId: `local-edit-${Date.now()}`
    })
    setShareTitle('未命名作品')
    setCloudWork(null)
    setIsCloudSynced(false)
    persistEditorDraft(nextMatrix, '未命名作品', null, false)
  }

  function handleRestoreLocalDraft() {
    const draft = readPixelEditorDraft()
    if (!draft) {
      setHasLocalDraft(false)
      showToast('没有可恢复的本地草稿')
      return
    }

    const supportedBoard = BOARD_SIZE_OPTIONS.find(
      (option) =>
        option.width === draft.boardSize.width && option.height === draft.boardSize.height
    )
    if (!supportedBoard) {
      showToast('草稿尺寸已不受支持')
      return
    }

    const summary = buildPixelColorSummary(draft.pixelMatrix, fullPaletteList)
    usePatternStore.getState().setBoardSize(draft.boardSize)
    usePatternStore.setState({
      originalImage: null,
      generatedImage: null,
      exampleImage: null,
      pixelMatrix: draft.pixelMatrix,
      gridSize: draft.boardSize,
      colorSummary: summary,
      totalBeads: countPlacedBeads(draft.pixelMatrix),
      palettePreset: draft.palettePreset,
      sessionId: `local-edit-${Date.now()}`
    })
    setShareTitle(draft.title)
    setCloudWork(draft.cloudWork ?? null)
    setIsCloudSynced(Boolean(draft.cloudWork && draft.cloudSynced !== false))
    showToast('已恢复本地草稿')
  }

  function handleSaveEditor() {
    const currentState = usePatternStore.getState()
    if (currentState.totalBeads === 0) {
      showToast('请先在画布上完成一些创作')
      return
    }

    if (!persistEditorDraft(currentState.pixelMatrix)) {
      showToast('本机存储空间不足或不可用，保存失败')
      return
    }
    rememberGeneratedPattern({
      title: shareTitle || '未命名作品',
      sourceLabel: currentState.originalImage ? '图片创作' : '自由创作'
    })
    showToast('作品已保存到本机')
  }

  async function handleSaveCloudEditor() {
    const currentState = usePatternStore.getState()
    if (currentState.totalBeads === 0) {
      showToast('请先在画布上完成一些创作')
      return
    }

    setIsCloudSaving(true)
    try {
      const document = buildPrivateCloudCanvasDocument({
        gridSize: currentState.gridSize,
        pixelMatrix: currentState.pixelMatrix,
        colorSummary: currentState.colorSummary,
        palettePreset: currentState.palettePreset
      })
      const saved = cloudWork
        ? await updatePrivateCloudWork(userId, cloudWork.id, {
            expected_version: cloudWork.version,
            title: sanitizePatternTitle(shareTitle || '未命名作品'),
            source_label: currentState.originalImage ? '图片创作' : '自由创作',
            document
          })
        : await createPrivateCloudWork(userId, {
            title: sanitizePatternTitle(shareTitle || '未命名作品'),
            source_label: currentState.originalImage ? '图片创作' : '自由创作',
            document
          })
      const revision = { id: saved.id, version: saved.version }
      setCloudWork(revision)
      setIsCloudSynced(true)
      persistEditorDraft(currentState.pixelMatrix, shareTitle, revision, true)
      showToast(`作品已保存到私有云（版本 ${saved.version}）`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '私有云保存失败')
    } finally {
      setIsCloudSaving(false)
    }
  }

  function updateCropBox() {
    const cropState = cropStateRef.current
    setCropBoxStyle({
      left: `${cropState.box.x * cropState.scale}px`,
      top: `${cropState.box.y * cropState.scale}px`,
      width: `${cropState.box.width * cropState.scale}px`,
      height: `${cropState.box.height * cropState.scale}px`
    })
  }

  function resetCropState() {
    cropStateRef.current = {
      file: null,
      img: null,
      scale: 1,
      baseBox: { x: 0, y: 0, width: 0, height: 0 },
      box: { x: 0, y: 0, width: 0, height: 0 },
      zoom: 1,
      dragging: false,
      startX: 0,
      startY: 0
    }
    setCropImageStyle({})
    setCropBoxStyle({})
    setCropImageUrl('')
    setCropZoom(1)
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

        const cropRect = createAspectCropRect(
          image.width,
          image.height,
          boardSize.width,
          boardSize.height
        )
        cropStateRef.current.baseBox = cropRect
        cropStateRef.current.box = cropRect
        cropStateRef.current.zoom = 1

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
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

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
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    const cropState = cropStateRef.current
    const image = cropState.img
    const file = cropState.file

    if (!image || !file || !cropState.box.width || !cropState.box.height) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(cropState.box.width))
    canvas.height = Math.max(1, Math.round(cropState.box.height))
    const context = canvas.getContext('2d')

    if (!context) {
      showToast('裁剪失败')
      return
    }

    context.drawImage(
      image,
      cropState.box.x,
      cropState.box.y,
      cropState.box.width,
      cropState.box.height,
      0,
      0,
      canvas.width,
      canvas.height
    )

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95)
    })

    if (!blob) {
      showToast('裁剪失败')
      return
    }

    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    const croppedFileName = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.jpg`
    const croppedFile = new File([blob], croppedFileName, { type: 'image/jpeg' })
    const croppedUrl = URL.createObjectURL(croppedFile)
    replaceOwnedOriginalImageUrl(croppedUrl)
    cancelCrop()
    usePatternStore.setState({ exampleImage: null, isGenerating: true })
    try {
      await runGenerate(croppedUrl, croppedFile.name)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '图片生成失败')
    }
  }

  function handleGenerationModeChange(value: string) {
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    if (value === LOCAL_GENERATION_MODE) {
      setStyleTransferMode('none')
      showToast('已切换为本地像素化，不会调用万相')
      return
    }

    const nextStyleIndex = Number.parseInt(value.replace(/^wanxiang:/, ''), 10)
    if (!GENERATION_STYLES.some((style) => style.index === nextStyleIndex)) {
      showToast('万相风格无效，请重新选择')
      return
    }

    usePatternStore.getState().setStyleIndex(nextStyleIndex)
    setStyleTransferMode('wanxiang')
    const styleName = GENERATION_STYLES.find(
      (style) => style.index === nextStyleIndex
    )?.name
    showToast(`已选择万相${styleName ? `「${styleName}」` : ''}，生成时将使用云端 AI`)
  }

  async function handleRegenerateWithSelectedMode() {
    if (!originalImage) {
      showToast('请先导入图片')
      return
    }

    try {
      await runGenerate(originalImage)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重新生成失败')
    }
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

  async function runGenerate(
    filePath: string,
    fileName?: string,
    operationToken = Symbol('generate-image')
  ) {
    const currentOwner = imageOperationOwnerRef.current
    if (currentOwner && currentOwner !== operationToken) {
      throw new Error('图片正在生成，请稍候')
    }

    imageOperationOwnerRef.current = operationToken

    try {
      Taro.showLoading({
        title: styleTransferMode === 'wanxiang' ? '万相生成中...' : '生成中...'
      })
      const response = await usePatternStore.getState().generateFromFile(filePath, {
        fileName,
        styleTransfer: styleTransferMode,
        ...getGenerateOverrides()
      })
      useDeviceStore.getState().clearHighlightCodes()
      const nextTitle = sanitizePatternTitle(fileName || shareTitle || '未命名图案')
      setCloudWork(null)
      setIsCloudSynced(false)
      persistEditorDraft(response.pixel_matrix, nextTitle, null, false)
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

        if (
          !deviceState.isSending &&
          patternState.gridSize.width === patternState.gridSize.height
        ) {
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
        const deviceId = bleConnectedUuid || targetDeviceUuid
        if (deviceId) {
          if (sendErrorMessage.toLowerCase().includes('rejected')) {
            reportBleNack({
              deviceId,
              operation: '图像发送',
              message: sendErrorMessage
            })
          } else {
            reportBleTimeout({
              deviceId,
              operation: '图像发送',
              message: sendErrorMessage
            })
          }
        }
      } finally {
        useDeviceStore.getState().setIsSending(false)
      }

      if (sentToBle) {
        const deviceId = bleConnectedUuid || targetDeviceUuid
        if (deviceId) {
          reportBleAck({
            deviceId,
            operation: '图像发送'
          })
        }
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

      const generationMessage =
        styleTransferMode === 'wanxiang'
          ? '万相风格图已生成并转换为拼豆图'
          : '图案已生成'

      showToast(
        sendErrorMessage
          ? `${generationMessage}，但蓝牙发送失败：${sendErrorMessage}${publishMessage}`
          : sentToBle
            ? `${generationMessage}并已推送到设备${publishMessage}`
            : `${generationMessage}${publishMessage}`
      )
      return response
    } finally {
      if (imageOperationOwnerRef.current === operationToken) {
        imageOperationOwnerRef.current = null
      }
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
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    const operationToken = Symbol('load-example')
    imageOperationOwnerRef.current = operationToken
    try {
      Taro.showLoading({
        title: '载入示例...'
      })
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

      if (imageOperationOwnerRef.current !== operationToken) {
        throw new Error('图片正在生成，请稍候')
      }

      replaceOwnedOriginalImageUrl(null)
      await runGenerate(response.tempFilePath, `${item.id}_original.jpg`, operationToken)
    } catch (error) {
      usePatternStore.setState({
        isGenerating: false
      })
      showToast(error instanceof Error ? error.message : '示例图片加载失败')
    } finally {
      if (imageOperationOwnerRef.current === operationToken) {
        imageOperationOwnerRef.current = null
      }
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

  async function handleChangeBoardSize(boardId: string) {
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    const nextBoard = getBoardSize(boardId)
    const store = usePatternStore.getState()
    const previousMatrix = store.pixelMatrix
    store.setBoardSize({ width: nextBoard.width, height: nextBoard.height })

    if (store.originalImage) {
      try {
        await runGenerate(store.originalImage)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '重新生成失败')
      }
      return
    }

    if (hasGeneratedPattern(previousMatrix)) {
      syncEditedPattern(
        resizePixelMatrix(previousMatrix, nextBoard.width, nextBoard.height)
      )
      showToast(`画布已调整为 ${nextBoard.label}`)
    }
  }

  function handleCropZoomChange(nextZoom: number) {
    const cropState = cropStateRef.current
    if (!cropState.img || !Number.isFinite(nextZoom)) {
      return
    }

    const normalizedZoom = Math.max(1, Math.min(3, nextZoom))
    cropState.box = zoomCropRect(
      cropState.baseBox,
      cropState.box,
      cropState.img.width,
      cropState.img.height,
      normalizedZoom
    )
    cropState.zoom = normalizedZoom
    setCropZoom(normalizedZoom)
    updateCropBox()
  }

  function handleResetCrop() {
    const cropState = cropStateRef.current
    cropState.box = { ...cropState.baseBox }
    cropState.zoom = 1
    setCropZoom(1)
    updateCropBox()
  }

  async function handleChangeDifficulty(nextDifficultyValue: string) {
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

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
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

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
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

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
    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    replaceOwnedOriginalImageUrl(null)
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
    reportDeviceConnection({
      deviceId: normalizedUuid,
      transport: 'ble',
      state: 'online'
    })
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
      if (!isCancelled && targetDeviceUuid) {
        reportDeviceConnection({
          deviceId: targetDeviceUuid,
          transport: 'ble',
          state: 'error',
          message: error instanceof Error ? error.message : '蓝牙连接失败'
        })
      }
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
  const selectedBoard =
    BOARD_SIZE_OPTIONS.find(
      (option) => option.width === boardSize.width && option.height === boardSize.height
    ) ?? BOARD_SIZE_OPTIONS[0]
  const isRestoringGeneratedState = isGenerating && !hasPattern
  const bgToggleStyle = useMemo(
    () => getBgToggleStyle(removeBackground),
    [removeBackground]
  )
  const isBleReady =
    bleConnectionStatus === 'connected' && bleCharacteristicStatus === 'ready'
  const bleAvailable =
    typeof navigator !== 'undefined' && !!navigator.bluetooth
  const monitoredDeviceId = (bleConnectedUuid || targetDeviceUuid).trim().toUpperCase()
  const monitoredDevice = monitoredDeviceId
    ? monitoredDevices[monitoredDeviceId] ?? null
    : null
  const monitoredAlerts = monitoredDeviceId
    ? deviceAlerts.filter((alert) => alert.deviceId === monitoredDeviceId)
    : []
  const latestUnacknowledgedAlert = monitoredAlerts.find(
    (alert) => alert.resolvedAt == null && alert.acknowledgedAt == null
  )

  useEffect(() => startDeviceOfflineMonitor(), [])

  useEffect(() => {
    if (!isBleReady || !bleConnectedUuid || typeof bleAdapter.readStatus !== 'function') {
      return
    }

    let disposed = false
    let polling = false
    const pollStatus = async () => {
      if (disposed || polling) {
        return
      }
      polling = true
      try {
        const status = await bleAdapter.readStatus?.()
        if (!disposed && status) {
          reportDeviceHeartbeat({
            deviceId: bleConnectedUuid,
            transport: 'ble',
            telemetry: status
          })
        }
      } catch (error) {
        if (!disposed) {
          reportBleTimeout({
            deviceId: bleConnectedUuid,
            operation: '状态心跳',
            message: error instanceof Error ? error.message : '设备状态读取失败'
          })
        }
      } finally {
        polling = false
      }
    }

    void pollStatus()
    const timer = setInterval(() => {
      void pollStatus()
    }, 10_000)

    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [bleConnectedUuid, isBleReady])

  useEffect(() => {
    if (
      !latestUnacknowledgedAlert ||
      lastAlertToastRef.current === latestUnacknowledgedAlert.id
    ) {
      return
    }
    lastAlertToastRef.current = latestUnacknowledgedAlert.id
    showToast(`设备预警：${latestUnacknowledgedAlert.message}`)
  }, [latestUnacknowledgedAlert?.id])
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

  return (
    <div className='template-home-page'>
      <div className='site-version-badge'>v12</div>
      <div className='main-container'>
        <div id='result-area' className='result-area'>
          <div className='canvas-toolbar'>
            <button
              id='clear-btn'
              className='toolbar-btn'
              onClick={handleClear}
              disabled={isGenerating}
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
              disabled={isGenerating}
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
              aria-disabled={isGenerating}
            >
              <span className='toolbar-btn-icon'>+</span>
            </label>
            <input
              id='file-input'
              className='hidden-input'
              type='file'
              accept='image/jpeg,image/png,image/gif,image/webp'
              ref={fileInputRef}
              disabled={isGenerating}
              onChange={(event) => handleUploadFileSelection(event.target.files?.[0] ?? null)}
            />
            <select
              id='generation-style'
              className='led-size-btn generation-style-select'
              title='图片生成方式'
              aria-label='图片生成方式'
              value={
                styleTransferMode === 'wanxiang'
                  ? `wanxiang:${styleIndex}`
                  : LOCAL_GENERATION_MODE
              }
              disabled={isGenerating}
              onChange={(event) => handleGenerationModeChange(event.target.value)}
            >
              <option value={LOCAL_GENERATION_MODE}>本地像素化</option>
              {GENERATION_STYLES.map((style) => (
                <option key={style.index} value={`wanxiang:${style.index}`}>
                  万相 · {style.name}
                </option>
              ))}
            </select>
            <button
              id='regenerate-btn'
              className='toolbar-btn'
              type='button'
              disabled={!originalImage || isGenerating}
              onClick={() => void handleRegenerateWithSelectedMode()}
              title={
                styleTransferMode === 'wanxiang'
                  ? '使用所选万相风格重新生成'
                  : '使用本地像素化重新生成'
              }
            >
              {styleTransferMode === 'wanxiang' ? 'AI' : '重'}
            </button>
            <select
              id='board-size'
              className='led-size-btn board-size-select'
              title='钉板尺寸'
              aria-label='钉板尺寸'
              value={selectedBoard.id}
              disabled={isGenerating}
              onChange={(event) => void handleChangeBoardSize(event.target.value)}
            >
              {BOARD_SIZE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
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

          <div
            className={`canvas-container ${hasPattern ? 'canvas-container--editor' : ''}`}
            style={{ margin: '0 auto', position: 'relative' }}
          >
            {isRestoringGeneratedState ? (
              <div className='creation-loading'>正在智能像素化并生成拼豆图纸...</div>
            ) : hasPattern ? (
              <PixelEditorH5
                matrix={pixelMatrix}
                colors={fullPaletteList}
                presets={presets}
                palettePreset={palettePreset}
                boardLabel={selectedBoard.label}
                onChange={syncEditedPattern}
                onPalettePresetChange={(preset) => {
                  usePatternStore.getState().setPalettePreset(preset)
                  setIsCloudSynced(false)
                  persistEditorDraft(
                    usePatternStore.getState().pixelMatrix,
                    shareTitle,
                    cloudWork,
                    false
                  )
                }}
                onSave={handleSaveEditor}
                onCloudSave={() => {
                  void handleSaveCloudEditor()
                }}
                isCloudSaving={isCloudSaving}
                cloudSaved={isCloudSynced}
              />
            ) : (
              <section className='creation-launcher' aria-labelledby='creation-launcher-title'>
                <div className='creation-launcher__copy'>
                  <span className='creation-launcher__eyebrow'>PixelDoodle Web Studio</span>
                  <h1 id='creation-launcher-title'>从想法到拼豆图纸，一处完成</h1>
                  <p>
                    当前尺寸 {selectedBoard.label}。可直接自由创作，也可导入照片智能像素化，设备连接不是创作前提。
                  </p>
                </div>
                <div className='creation-launcher__actions'>
                  <button
                    className='creation-launcher__card creation-launcher__card--primary'
                    type='button'
                    onClick={handleCreateBlankCanvas}
                  >
                    <strong>新建空白画布</strong>
                    <span>画笔、橡皮、填充、撤销与缩放</span>
                  </button>
                  <button
                    id='upload-area'
                    className='creation-launcher__card'
                    type='button'
                    disabled={isGenerating}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <strong>导入图片生成</strong>
                    <span>按钉板比例校准后，一键智能像素化</span>
                  </button>
                  <button
                    className='creation-launcher__card'
                    type='button'
                    onClick={() => {
                      void Taro.redirectTo({
                        url: '/pages/materials/index'
                      })
                    }}
                  >
                    <strong>从海量素材库开始</strong>
                    <span>分类筛选图纸，一键适配并继续二次编辑</span>
                  </button>
                </div>
                {hasLocalDraft ? (
                  <button
                    className='creation-launcher__restore'
                    type='button'
                    onClick={handleRestoreLocalDraft}
                  >
                    恢复上次本地草稿
                  </button>
                ) : null}
              </section>
            )}
          </div>

          {homeViewState.showExamples && !isRestoringGeneratedState ? (
            <div
              id='examples-container'
              className='section examples-section'
              style={{ marginTop: '12px' }}
            >
              <div className='section-title' data-i18n='examples.title'>
                精选入门素材
              </div>
              <div className='examples-gallery'>
                {EXAMPLE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    className='example-item'
                    type='button'
                    disabled={isGenerating}
                    onClick={() => void handleSelectExample(item)}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      className='example-thumb'
                    />
                    <div className='example-name'>{item.title} · 套用并编辑</div>
                  </button>
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
                disabled={isGenerating}
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

          {totalBeads > 0 ? (
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
                  const nextTitle = event.target.value
                  setShareTitle(nextTitle)
                  if (cloudWork) {
                    setIsCloudSynced(false)
                  }
                  persistEditorDraft(
                    usePatternStore.getState().pixelMatrix,
                    nextTitle,
                    cloudWork,
                    false
                  )
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
          <DeviceMonitorPanel
            device={monitoredDevice}
            alerts={monitoredAlerts}
            onAcknowledgeAlert={acknowledgeDeviceAlert}
          />
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
        boardLabel={selectedBoard.label}
        gridWidth={selectedBoard.width}
        gridHeight={selectedBoard.height}
        zoom={cropZoom}
        confirmLabel={
          styleTransferMode === 'wanxiang'
            ? '万相生成并转换为拼豆图'
            : '本地像素化并生成'
        }
        onCancel={cancelCrop}
        onConfirm={() => void confirmCrop()}
        onReset={handleResetCrop}
        onZoomChange={handleCropZoomChange}
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
