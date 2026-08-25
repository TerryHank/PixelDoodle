import Taro from '@tarojs/taro'
import { isTauri } from '@tauri-apps/api/core'
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
import {
  CropDialogH5,
  type ImportWorkflowStep
} from '@/components/crop-dialog/index.h5'
import { DeviceMonitorPanel } from '@/components/device-monitor-panel'
import { PairSheetH5, type PairSheetBleOption } from '@/components/pair-sheet/index.h5'
import { PatternThumb } from '@/components/pattern-thumb'
import { ProfileAvatar } from '@/components/profile-avatar'
import { SettingsSheetH5 } from '@/components/settings-sheet/index.h5'
import { ToastHost } from '@/components/toast-host'
import {
  V13CreationSetup,
  V13HomeLanding,
  V13LaunchScreen
} from '@/components/v13-home/index.h5'
import { PixelEditorH5 } from '@/features/pixel-editor/index.h5'
import {
  BOARD_SIZE_OPTIONS,
  buildPixelColorSummary,
  countPlacedBeads,
  createEmptyPixelMatrix,
  getBoardSize
} from '@/features/pixel-editor/model'
import { fitPixelMatrixToBoard } from '@/features/material-library/model'
import {
  clampCropRect,
  createFullImageCropRect,
  fitImageWithinBoardGrid,
  zoomCropRect,
  type CropRect
} from '@/features/image-calibration/model'
import {
  buildImageImportPlan,
  type ImageImportMode
} from '@/features/image-calibration/import-mode'
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
import {
  deriveH5HomeViewState,
  getBleConnectedToastMessage,
  restoreBleConnectedUuid,
  selectAuthorizedDeviceForReconnect
} from './h5-runtime'
import { hideLoadingSafely } from '@/utils/loading'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VALID_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const MAX_CROP_IMAGE_EDGE = 4096
const MAX_CROP_IMAGE_PIXELS = 16 * 1024 * 1024
const LOCAL_DRAFT_STORAGE_KEY = 'pixeldoodle:pixel-editor-draft'
const LAST_BLE_DEVICE_STORAGE_KEY = 'pixeldoodle:h5-last-ble-device:v1'
let ownedOriginalImageUrl: string | null = null

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
  const cropLoadOwnerRef = useRef<symbol | null>(null)
  const cropSourceUrlRef = useRef<string | null>(null)
  const importProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoReconnectStartedRef = useRef(false)
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
  const [bleConnectedUuid, setBleConnectedUuid] = useState<string | null>(() => {
    const deviceState = useDeviceStore.getState()
    return restoreBleConnectedUuid({
      targetDeviceUuid: deviceState.targetDeviceUuid,
      connectionStatus: deviceState.bleConnectionStatus,
      characteristicStatus: deviceState.bleCharacteristicStatus
    })
  })
  const [difficultyMode, setDifficultyMode] = useState('0.25')
  const [customPixelSize, setCustomPixelSize] = useState(8)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropGridSize, setCropGridSize] = useState({ width: 29, height: 29 })
  const [cropImageUrl, setCropImageUrl] = useState('')
  const [cropImageStyle, setCropImageStyle] = useState<Record<string, string>>({})
  const [cropBoxStyle, setCropBoxStyle] = useState<Record<string, string>>({})
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false)
  const [imageImportMode, setImageImportMode] = useState<ImageImportMode>('photo')
  const imageImportModeRef = useRef<ImageImportMode>('photo')
  const [photoColorStyle, setPhotoColorStyle] = useState<'natural' | 'vivid' | 'soft'>('natural')
  const photoColorStyleRef = useRef<'natural' | 'vivid' | 'soft'>('natural')
  const [importWorkflowStep, setImportWorkflowStep] = useState<ImportWorkflowStep>('guide')
  const [importProgress, setImportProgress] = useState(0)
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
  const [localSaveFailed, setLocalSaveFailed] = useState(false)
  const [isCreationSetupOpen, setIsCreationSetupOpen] = useState(false)
  const [showV13Launch, setShowV13Launch] = useState(false)

  useEffect(() => {
    document.title = 'DIY拼豆 · v14'
    const launchKey = 'pixeldoodle:v14-launch-shown'
    if (window.sessionStorage.getItem(launchKey)) return
    window.sessionStorage.setItem(launchKey, '1')
    setShowV13Launch(true)
    const timer = window.setTimeout(() => setShowV13Launch(false), 1450)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => () => {
    if (importProgressTimerRef.current) {
      clearInterval(importProgressTimerRef.current)
      importProgressTimerRef.current = null
    }
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
    if (autoReconnectStartedRef.current || isTauri()) {
      return
    }
    autoReconnectStartedRef.current = true

    const currentDeviceState = useDeviceStore.getState()
    if (
      currentDeviceState.bleConnectionStatus === 'connected' &&
      currentDeviceState.bleCharacteristicStatus === 'ready' &&
      currentDeviceState.targetDeviceUuid
    ) {
      return
    }

    let cancelled = false
    const reconnect = async () => {
      if (typeof bleAdapter.getAuthorizedDevices !== 'function') {
        return
      }

      try {
        const devices = await bleAdapter.getAuthorizedDevices()
        if (cancelled) {
          return
        }
        setAuthorizedBleDevices(devices)
        const rememberedUuid = readPersistedState<string | null>(
          LAST_BLE_DEVICE_STORAGE_KEY,
          null
        )
        const device = selectAuthorizedDeviceForReconnect(devices, rememberedUuid)
        if (!device || typeof bleAdapter.connectKnownDevice !== 'function') {
          return
        }

        useDeviceStore.getState().setBleConnectionStatus('connecting')
        useDeviceStore.getState().setBleCharacteristicStatus('discovering')
        const connectedUuid = await bleAdapter.connectKnownDevice(device.key)
        if (!cancelled) {
          await completeBleConnectionFlow(connectedUuid)
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to restore authorized Bluetooth device:', error)
          useDeviceStore.getState().setBleConnectionStatus('idle')
          useDeviceStore.getState().setBleCharacteristicStatus('idle')
          setBleConnectedUuid(null)
        }
      }
    }

    void reconnect()
    return () => {
      cancelled = true
    }
  }, [])

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
    setLocalSaveFailed(!saved)
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
    setIsCreationSetupOpen(false)
  }

  function handleRestoreLocalDraft() {
    const draft = readPixelEditorDraft()
    if (!draft) {
      setHasLocalDraft(false)
      showToast('没有可恢复的本地草稿')
      return
    }

    const supportsDraftGrid =
      Number.isInteger(draft.boardSize.width) &&
      Number.isInteger(draft.boardSize.height) &&
      draft.boardSize.width >= 1 &&
      draft.boardSize.height >= 1 &&
      draft.boardSize.width <= 104 &&
      draft.boardSize.height <= 104
    if (!supportsDraftGrid) {
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
    setLocalSaveFailed(false)
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
    showToast('作品已保存为应用内草稿')
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
    if (cropSourceUrlRef.current) {
      URL.revokeObjectURL(cropSourceUrlRef.current)
      cropSourceUrlRef.current = null
    }
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

  function stopImportProgress(nextProgress = 0) {
    if (importProgressTimerRef.current) {
      clearInterval(importProgressTimerRef.current)
      importProgressTimerRef.current = null
    }
    setImportProgress(nextProgress)
  }

  function startImportProgress() {
    stopImportProgress(8)
    importProgressTimerRef.current = setInterval(() => {
      setImportProgress((current) => Math.min(92, current + Math.max(1, Math.round((96 - current) * 0.08))))
    }, 180)
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
    stopImportProgress()
    setIsCropDialogOpen(false)
    resetCropState()
    setImportWorkflowStep('guide')
  }

  function cancelImportWorkflow() {
    if (imageOperationOwnerRef.current) {
      showToast('正在识别图纸，请稍候')
      return
    }
    if (importWorkflowStep === 'result' || importWorkflowStep === 'correction') {
      usePatternStore.getState().clear()
    }
    cancelCrop()
  }

  function finishImportWorkflow() {
    const state = usePatternStore.getState()
    if (hasGeneratedPattern(state.pixelMatrix)) {
      const title = sanitizePatternTitle(shareTitle || '未命名图案')
      persistEditorDraft(state.pixelMatrix, title, null, false)
      rememberGeneratedPattern({
        title,
        sourceLabel: imageImportModeRef.current === 'photo' ? '照片转拼豆' : '导入图纸'
      })
      showToast('图案已本地生成')
    }
    stopImportProgress()
    setIsCropDialogOpen(false)
    resetCropState()
    setImportWorkflowStep('guide')
  }

  function startPixelImportWorkflow() {
    if (imageOperationOwnerRef.current || isGenerating) {
      showToast('图片正在生成，请稍候')
      return
    }
    imageImportModeRef.current = 'pixel-art'
    setImageImportMode('pixel-art')
    resetCropState()
    setImportWorkflowStep('guide')
    setIsCropDialogOpen(true)
  }

  function validateSelectedFile(file: File) {
    const normalizedType = file.type.trim().toLowerCase()
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    const hasSupportedType = VALID_IMAGE_TYPES.includes(normalizedType)
    const hasGenericType =
      !normalizedType || normalizedType === 'application/octet-stream'
    if (
      !hasSupportedType &&
      !(hasGenericType && VALID_IMAGE_EXTENSIONS.includes(extension))
    ) {
      showToast('仅支持 JPG、PNG、GIF、WebP')
      return false
    }

    if (file.size > 20 * 1024 * 1024) {
      showToast('图片大小不能超过 20MB')
      return false
    }

    return true
  }

  function loadCropImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片已损坏或格式无法解码'))
      image.src = url
    })
  }

  function replaceCropSourceUrl(nextUrl: string) {
    if (cropSourceUrlRef.current && cropSourceUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(cropSourceUrlRef.current)
    }
    cropSourceUrlRef.current = nextUrl
  }

  async function downsampleCropImageIfNeeded(
    image: HTMLImageElement,
    sourceUrl: string,
    importMode: ImageImportMode
  ) {
    const pixelScale = Math.sqrt(
      MAX_CROP_IMAGE_PIXELS / Math.max(1, image.width * image.height)
    )
    const scale = Math.min(
      1,
      MAX_CROP_IMAGE_EDGE / image.width,
      MAX_CROP_IMAGE_EDGE / image.height,
      pixelScale
    )
    if (scale >= 1) {
      return { image, imageUrl: sourceUrl }
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前设备无法处理这张大图')
    context.imageSmoothingEnabled = importMode === 'photo'
    if (importMode === 'photo') {
      context.imageSmoothingQuality = 'high'
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        resolve,
        importMode === 'pixel-art' ? 'image/png' : 'image/jpeg',
        0.92
      )
    })
    if (!blob) throw new Error('大图优化失败，请选择尺寸较小的图片')

    const resizedUrl = URL.createObjectURL(blob)
    replaceCropSourceUrl(resizedUrl)
    return {
      image: await loadCropImage(resizedUrl),
      imageUrl: resizedUrl
    }
  }

  async function showCropDialog(file: File) {
    if (cropLoadOwnerRef.current) {
      showToast('正在读取上一张图片，请稍候')
      return
    }

    const operationToken = Symbol('load-crop-image')
    cropLoadOwnerRef.current = operationToken
    Taro.showLoading({ title: '正在读取图片...' })
    resetCropState()

    try {
      const importMode = imageImportModeRef.current
      const sourceUrl = URL.createObjectURL(file)
      replaceCropSourceUrl(sourceUrl)
      const sourceImage = await loadCropImage(sourceUrl)
      const prepared = await downsampleCropImageIfNeeded(sourceImage, sourceUrl, importMode)
      if (cropLoadOwnerRef.current !== operationToken) return

      const image = prepared.image
      cropStateRef.current.file = file
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
      const fittedGrid = fitImageWithinBoardGrid(
        image.width,
        image.height,
        boardSize.width,
        boardSize.height
      )
      const cropRect = createFullImageCropRect(image.width, image.height)
      cropStateRef.current.baseBox = cropRect
      cropStateRef.current.box = cropRect
      cropStateRef.current.zoom = 1
      setCropGridSize(fittedGrid)

      setCropImageStyle({
        width: `${renderedWidth}px`,
        height: `${renderedHeight}px`
      })
      setCropImageUrl(prepared.imageUrl)
      updateCropBox()
      setImportWorkflowStep(importMode === 'pixel-art' ? 'align' : 'recognizing')
      setIsCropDialogOpen(true)
      if (importMode === 'photo') {
        window.setTimeout(() => {
          void confirmCrop()
        }, 0)
      }
    } catch (error) {
      resetCropState()
      showToast(error instanceof Error ? error.message : '图片读取失败')
    } finally {
      if (cropLoadOwnerRef.current === operationToken) {
        cropLoadOwnerRef.current = null
      }
      await hideLoadingSafely(() => Taro.hideLoading())
    }
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

    void showCropDialog(file)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function openImageFilePicker(importMode: ImageImportMode) {
    if (imageOperationOwnerRef.current || isGenerating) {
      showToast('图片正在生成，请稍候')
      return
    }

    const input = fileInputRef.current
    if (!input) {
      showToast('图片选择器尚未就绪，请重试')
      return
    }

    imageImportModeRef.current = importMode
    setImageImportMode(importMode)
    input.value = ''
    input.click()
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

    const importPlan = buildImageImportPlan(
      imageImportModeRef.current,
      cropState.box.width,
      cropState.box.height,
      cropGridSize.width,
      cropGridSize.height
    )
    const canvas = document.createElement('canvas')
    canvas.width = importPlan.canvasWidth
    canvas.height = importPlan.canvasHeight
    const context = canvas.getContext('2d')

    if (!context) {
      showToast('裁剪失败')
      return
    }

    context.imageSmoothingEnabled = importPlan.imageSmoothingEnabled
    if (importPlan.imageSmoothingEnabled) {
      context.imageSmoothingQuality = 'high'
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
      canvas.toBlob(resolve, importPlan.mimeType, 0.95)
    })

    if (!blob) {
      showToast('裁剪失败')
      return
    }

    if (imageOperationOwnerRef.current) {
      showToast('图片正在生成，请稍候')
      return
    }

    const croppedFileName = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${importPlan.extension}`
    const croppedFile = new File([blob], croppedFileName, { type: importPlan.mimeType })
    const croppedUrl = URL.createObjectURL(croppedFile)
    replaceOwnedOriginalImageUrl(croppedUrl)
    setImportWorkflowStep('recognizing')
    startImportProgress()
    usePatternStore.setState({ exampleImage: null, isGenerating: true })
    try {
      await runGenerate(croppedUrl, croppedFile.name, Symbol('import-preview'), {
        showLoading: false,
        previewOnly: true
      })
      stopImportProgress(100)
      setImportWorkflowStep('result')
    } catch (error) {
      stopImportProgress()
      setImportWorkflowStep(imageImportModeRef.current === 'pixel-art' ? 'crop' : 'guide')
      showToast(error instanceof Error ? error.message : '图片生成失败')
    }
  }

  function handleImportPrevious() {
    if (importWorkflowStep === 'correction') {
      setImportWorkflowStep('result')
      return
    }
    if (importWorkflowStep === 'crop') {
      setImportWorkflowStep('align')
      return
    }
    if (importWorkflowStep === 'align') {
      setImportWorkflowStep('guide')
      return
    }
    if (importWorkflowStep === 'result') {
      cancelCrop()
    }
  }

  async function regenerateImportResult() {
    if (imageOperationOwnerRef.current) {
      showToast('正在更新预览，请稍候')
      return
    }
    const source = usePatternStore.getState().originalImage
    if (!source) return

    setImportWorkflowStep('recognizing')
    startImportProgress()
    usePatternStore.setState({ isGenerating: true })
    try {
      await runGenerate(source, undefined, Symbol('refresh-import-preview'), {
        showLoading: false,
        previewOnly: true
      })
      stopImportProgress(100)
      setImportWorkflowStep('result')
    } catch (error) {
      stopImportProgress()
      setImportWorkflowStep('result')
      showToast(error instanceof Error ? error.message : '预览更新失败')
    }
  }

  function handleImportPaletteChange(value: string) {
    usePatternStore.getState().setPalettePreset(value)
    void regenerateImportResult()
  }

  function handleImportColorStyleChange(value: 'natural' | 'vivid' | 'soft') {
    photoColorStyleRef.current = value
    setPhotoColorStyle(value)
    void regenerateImportResult()
  }

  function handleImportBoardSelect(boardId: string) {
    handleCropBoardChange(boardId)
    if (importWorkflowStep === 'result' || importWorkflowStep === 'correction') {
      void regenerateImportResult()
    }
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
    const store = usePatternStore.getState()
    const paletteCodes = store.presets[store.palettePreset]?.codes
    const paletteColorLimit = paletteCodes?.length ?? store.fullPaletteList.length
    const photoAdjustments = imageImportModeRef.current === 'photo'
      ? photoColorStyleRef.current === 'vivid'
        ? { contrast: 18, saturation: 25, sharpness: 30 }
        : photoColorStyleRef.current === 'soft'
          ? { contrast: -5, saturation: -20, sharpness: 10 }
          : { contrast: 10, saturation: 8, sharpness: 24 }
      : { contrast: 0, saturation: 0, sharpness: 0 }
    const qualityOverrides = {
      ...photoAdjustments,
      useDithering: false,
      maxColors: Math.max(1, paletteColorLimit),
      similarityThreshold: 0,
      preserveDetail: true
    }

    if (difficultyMode === 'custom') {
      return {
        mode: 'pixel_size' as const,
        pixelSize: customPixelSize,
        ...qualityOverrides
      }
    }

    return {
      mode: 'fixed_grid' as const,
      ...qualityOverrides
    }
  }

  async function runGenerate(
    filePath: string,
    fileName?: string,
    operationToken = Symbol('generate-image'),
    options: { showLoading?: boolean; previewOnly?: boolean } = {}
  ) {
    const currentOwner = imageOperationOwnerRef.current
    if (currentOwner && currentOwner !== operationToken) {
      throw new Error('图片正在生成，请稍候')
    }

    imageOperationOwnerRef.current = operationToken

    try {
      if (options.showLoading !== false) {
        Taro.showLoading({ title: '正在本地识别...' })
      }
      const targetBoard = { ...usePatternStore.getState().boardSize }
      const sourceImage = await loadCropImage(filePath)
      const containedGrid = fitImageWithinBoardGrid(
        sourceImage.width,
        sourceImage.height,
        targetBoard.width,
        targetBoard.height
      )
      const generationOverrides = getGenerateOverrides()
      const response = await usePatternStore.getState().generateFromFile(filePath, {
        fileName,
        ...generationOverrides,
        ...(generationOverrides.mode === 'fixed_grid'
          ? {
              gridWidth: containedGrid.width,
              gridHeight: containedGrid.height
            }
          : {})
      })
      const responseMatchesBoard =
        response.grid_size.width === targetBoard.width &&
        response.grid_size.height === targetBoard.height
      const containedMatrix = responseMatchesBoard
        ? response.pixel_matrix
        : fitPixelMatrixToBoard(response.pixel_matrix, targetBoard)
      const containedSummary = responseMatchesBoard
        ? response.color_summary
        : buildPixelColorSummary(containedMatrix, usePatternStore.getState().fullPaletteList)
      const containedResponse = responseMatchesBoard
        ? response
        : {
            ...response,
            grid_size: targetBoard,
            pixel_matrix: containedMatrix,
            color_summary: containedSummary,
            total_beads: countPlacedBeads(containedMatrix)
          }

      if (!responseMatchesBoard) {
        usePatternStore.setState({
          pixelMatrix: containedResponse.pixel_matrix,
          gridSize: containedResponse.grid_size,
          colorSummary: containedResponse.color_summary,
          totalBeads: containedResponse.total_beads
        })
      }
      useDeviceStore.getState().clearHighlightCodes()
      const nextTitle = sanitizePatternTitle(fileName || shareTitle || '未命名图案')
      setCloudWork(null)
      setIsCloudSynced(false)
      if (fileName || !shareTitle.trim()) {
        setShareTitle(nextTitle)
      }
      if (options.previewOnly) {
        return containedResponse
      }
      persistEditorDraft(containedResponse.pixel_matrix, nextTitle, null, false)
      rememberGeneratedPattern({
        title: nextTitle,
        sourceLabel: fileName ? '上传图片' : '示例图'
      })

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

      const generationMessage = '图案已本地生成'

      showToast(
        sendErrorMessage
          ? `${generationMessage}，但蓝牙发送失败：${sendErrorMessage}${publishMessage}`
          : sentToBle
            ? `${generationMessage}并已推送到设备${publishMessage}`
            : `${generationMessage}${publishMessage}`
      )
      return containedResponse
    } finally {
      if (imageOperationOwnerRef.current === operationToken) {
        imageOperationOwnerRef.current = null
      }
      if (options.showLoading !== false) {
        await hideLoadingSafely(() => Taro.hideLoading())
      }
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
    const previousBoard = { ...store.boardSize }
    if (
      previousBoard.width === nextBoard.width &&
      previousBoard.height === nextBoard.height
    ) {
      return
    }

    if (store.originalImage) {
      store.setBoardSize({ width: nextBoard.width, height: nextBoard.height })
      try {
        await runGenerate(store.originalImage)
      } catch (error) {
        usePatternStore.getState().setBoardSize(previousBoard)
        showToast(error instanceof Error ? error.message : '重新生成失败')
      }
      return
    }

    if (previousMatrix.length > 0) {
      const resized = fitPixelMatrixToBoard(previousMatrix, nextBoard)
      store.setBoardSize({ width: nextBoard.width, height: nextBoard.height })
      syncEditedPattern(resized)
      showToast(`作品已等比例适配到 ${nextBoard.label}`)
      return
    }

    store.setBoardSize({ width: nextBoard.width, height: nextBoard.height })
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

  function handleNudgeCrop(deltaX: number, deltaY: number) {
    const cropState = cropStateRef.current
    if (!cropState.img) return

    const stepX = Math.max(1, cropState.box.width * 0.02)
    const stepY = Math.max(1, cropState.box.height * 0.02)
    cropState.box = clampCropRect(
      {
        ...cropState.box,
        x: cropState.box.x + deltaX * stepX,
        y: cropState.box.y + deltaY * stepY
      },
      cropState.img.width,
      cropState.img.height
    )
    updateCropBox()
  }

  function handleCropBoardChange(boardId: string) {
    const nextBoard = getBoardSize(boardId)
    const cropImage = cropStateRef.current.img
    usePatternStore.getState().setBoardSize(nextBoard)
    if (cropImage) {
      setCropGridSize(
        fitImageWithinBoardGrid(
          cropStateRef.current.box.width,
          cropStateRef.current.box.height,
          nextBoard.width,
          nextBoard.height
        )
      )
    }
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
    writePersistedState(LAST_BLE_DEVICE_STORAGE_KEY, normalizedUuid)
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
  const fixedSelectedBoard = BOARD_SIZE_OPTIONS.find(
    (option) => option.width === boardSize.width && option.height === boardSize.height
  )
  const selectedBoard = fixedSelectedBoard ?? {
    id: `original-${boardSize.width}x${boardSize.height}`,
    label: `${boardSize.width} × ${boardSize.height}（原图比例）`,
    width: boardSize.width,
    height: boardSize.height
  }
  const isRestoringGeneratedState = isGenerating && !hasPattern
  const bgToggleStyle = useMemo(
    () => getBgToggleStyle(removeBackground),
    [removeBackground]
  )
  const isBleReady =
    bleConnectionStatus === 'connected' && bleCharacteristicStatus === 'ready'
  const bleAvailable =
    isTauri() || (typeof navigator !== 'undefined' && !!navigator.bluetooth)
  const bleUnavailableMessage = isTauri()
    ? '请开启系统蓝牙，并允许附近设备权限。'
    : '当前浏览器不支持 Web Bluetooth。Web 版请使用支持该能力的 Chrome 或 Edge，并通过 HTTPS 或 localhost 打开。'
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
            : '已授权拼豆板设备'
      }
    })

    if (
      rememberedUuid &&
      !items.some((item) => item.uuid.trim().toUpperCase() === rememberedUuid)
    ) {
      items.push({
        key: `remembered-${rememberedUuid}`,
        name: `拼豆板-${rememberedUuid}`,
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
      return bleUnavailableMessage
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
    return '还没有已授权的拼豆板设备，点“添加设备”进行首次连接。'
  }, [authorizedBleDevices.length, bleAvailable, bleConnectedUuid, bleConnectionStatus, bleUnavailableMessage, isBleReady])
  const pairSheetStatusTone: 'default' | 'ready' | 'connected' = isBleReady && bleConnectedUuid
    ? 'connected'
    : authorizedBleDevices.length > 0
      ? 'ready'
      : 'default'

  return (
    <div className='template-home-page'>
      <V13LaunchScreen visible={showV13Launch} />
      <div className='main-container'>
        <div id='result-area' className='result-area'>
          <input
            id='file-input'
            className='hidden-input'
            type='file'
            accept='image/jpeg,image/png,image/gif,image/webp'
            ref={fileInputRef}
            disabled={isGenerating}
            onChange={(event) => handleUploadFileSelection(event.target.files?.[0] ?? null)}
          />
          {hasPattern ? (
            <section className='v13-editor-tools' aria-label='创作快捷设置'>
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
              <span className='toolbar-btn-label'>主页</span>
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
              <span className='toolbar-btn-glyph'>背</span>
              <span className='toolbar-btn-label'>去背</span>
            </button>
            <label
              id='upload-btn'
              className='toolbar-btn'
              htmlFor='file-input'
              title='上传'
              aria-disabled={isGenerating}
            >
              <span className='toolbar-btn-icon'>+</span>
              <span className='toolbar-btn-label'>换图</span>
            </label>
            <span
              id='generation-style'
              className='led-size-btn generation-style-select'
              title='V14 仅使用离线本地像素化'
              aria-label='图片生成方式：本地像素化'
            >
              本地像素化
            </span>
            <button
              id='regenerate-btn'
              className='toolbar-btn'
              type='button'
              disabled={!originalImage || isGenerating}
              onClick={() => void handleRegenerateWithSelectedMode()}
              title='使用本地像素化重新生成'
            >
              <span className='toolbar-btn-glyph'>重</span>
              <span className='toolbar-btn-label'>重生成</span>
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
              {!fixedSelectedBoard ? (
                <option value={selectedBoard.id}>{selectedBoard.label}</option>
              ) : null}
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
              <span className='toolbar-btn-label'>导出</span>
            </button>
              </div>
            </section>
          ) : null}

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
                onBack={handleClear}
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
                localSaveFailed={localSaveFailed}
              />
            ) : isCreationSetupOpen ? (
              <V13CreationSetup
                boardOptions={BOARD_SIZE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label
                }))}
                paletteOptions={Object.entries(presets).map(([id, preset]) => ({
                  id,
                  label: preset.label
                }))}
                selectedBoard={selectedBoard.id}
                selectedPalette={palettePreset}
                onBack={() => setIsCreationSetupOpen(false)}
                onBoardChange={(value) => void handleChangeBoardSize(value)}
                onPaletteChange={(value) => usePatternStore.getState().setPalettePreset(value)}
                onStart={handleCreateBlankCanvas}
              />
            ) : (
              <V13HomeLanding
                hasLocalDraft={hasLocalDraft}
                onCreate={() => setIsCreationSetupOpen(true)}
                onPixelImport={startPixelImportWorkflow}
                onPhotoImport={() => openImageFilePicker('photo')}
                onOpenLibrary={() => {
                  void Taro.navigateTo({ url: '/pages/materials/index' })
                }}
                onOpenConnection={() => void handleOpenPairSheet()}
                onRestoreDraft={handleRestoreLocalDraft}
              />
            )}
          </div>

          {hasPattern && homeViewState.showExamples && !isRestoringGeneratedState ? (
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
          {hasPattern ? (
            <DeviceMonitorPanel
              device={monitoredDevice}
              alerts={monitoredAlerts}
              onAcknowledgeAlert={acknowledgeDeviceAlert}
            />
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
        step={importWorkflowStep}
        progress={importProgress}
        imageUrl={cropImageUrl}
        cropImageRef={cropImageRef}
        cropImageStyle={cropImageStyle}
        cropBoxStyle={cropBoxStyle}
        boardLabel={selectedBoard.label}
        gridWidth={cropGridSize.width}
        gridHeight={cropGridSize.height}
        zoom={cropZoom}
        importMode={imageImportMode}
        paletteOptions={Object.entries(presets).map(([id, preset]) => ({
          id,
          label: preset.label
        }))}
        selectedPalette={palettePreset}
        boardOptions={BOARD_SIZE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        selectedBoard={selectedBoard.id}
        colorStyle={photoColorStyle}
        pixelMatrix={pixelMatrix}
        paletteColors={fullPaletteList}
        colorSummary={colorSummary}
        totalBeads={totalBeads}
        modeHint={buildImageImportPlan(
          imageImportMode,
          1,
          1,
          cropGridSize.width,
          cropGridSize.height
        ).hint}
        onCancel={cancelImportWorkflow}
        onChooseFile={() => openImageFilePicker('pixel-art')}
        onPrevious={handleImportPrevious}
        onNext={() => setImportWorkflowStep('crop')}
        onConfirm={() => void confirmCrop()}
        onFinish={finishImportWorkflow}
        onOpenCorrection={() => setImportWorkflowStep('correction')}
        onPatternChange={syncEditedPattern}
        onReset={handleResetCrop}
        onZoomChange={handleCropZoomChange}
        onNudge={handleNudgeCrop}
        onPaletteChange={handleImportPaletteChange}
        onBoardChange={handleImportBoardSelect}
        onColorStyleChange={handleImportColorStyleChange}
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
      {!hasPattern && !isCreationSetupOpen ? <AppTabBar current='tool' /> : null}
    </div>
  )
}
