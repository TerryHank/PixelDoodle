import type { GridSize } from '@/types/api'

export interface ToolbarProps {
  targetDeviceUuid?: string
  removeBackground?: boolean
  boardSizeLabel: string
  styleLabel: string
  modeQuickLabel: string
  modeQuickConnected?: boolean
  boardSizeValue?: GridSize
  styleIndexValue?: number
  onToggleBackground?: () => void
  onClear?: () => void
  onPickImage?: () => void
  onOpenPairSheet?: () => void
  onOpenSettings?: () => void
  onChangeBoardSize?: (value: GridSize) => void
  onChangeStyle?: (value: number) => void
}
