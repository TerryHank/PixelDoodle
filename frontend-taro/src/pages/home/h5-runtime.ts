import type { ConnectionMode } from '@/types/device'

export type UploadAreaMode = 'upload'

export interface DeriveH5HomeViewStateInput {
  targetDeviceUuid: string | null
  bleConnectedUuid: string | null
  isBleReady: boolean
  hasPattern: boolean
  connectionMode: ConnectionMode
}

export interface H5HomeViewState {
  showUploadArea: boolean
  showExamples: boolean
  showCanvas: boolean
  showColorPanel: boolean
  uploadAreaMode: UploadAreaMode
  uploadAreaClassName: string
  uploadAreaIcon: string
  uploadAreaText: string
  uploadAreaHint: string
  toolbarChipText: string
}

export function getBleConnectedToastMessage(input: {
  targetDeviceUuid: string | null
  bleConnectedUuid: string | null
}) {
  const bleConnectedUuid = input.bleConnectedUuid?.trim() || ''
  const targetDeviceUuid = input.targetDeviceUuid?.trim() || ''

  if (bleConnectedUuid) {
    return `蓝牙已连接 ${bleConnectedUuid}`
  }

  if (targetDeviceUuid) {
    return '蓝牙连接成功'
  }

  return '蓝牙连接成功'
}

export function deriveH5HomeViewState(
  input: DeriveH5HomeViewStateInput
): H5HomeViewState {
  const targetDeviceUuid = input.targetDeviceUuid?.trim() || ''

  const uploadAreaMode: UploadAreaMode = 'upload'

  const baseState = {
    showUploadArea: !input.hasPattern,
    showExamples: !input.hasPattern,
    showCanvas: input.hasPattern,
    showColorPanel: input.hasPattern
  }

  return {
    ...baseState,
    uploadAreaMode,
    uploadAreaClassName: 'upload-area',
    uploadAreaIcon: '+',
    uploadAreaText: '点击上传图片',
    uploadAreaHint: 'JPG, PNG, GIF, WEBP (最大 20MB)',
    toolbarChipText: targetDeviceUuid
  }
}
