export interface ToolbarProps {
  targetDeviceUuid?: string
  removeBackground?: boolean
  ledSizeLabel: string
  styleLabel: string
  modeQuickLabel: string
  modeQuickConnected?: boolean
  ledSizeValue?: number
  styleIndexValue?: number
  onToggleBackground?: () => void
  onClear?: () => void
  onPickImage?: () => void
  onOpenPairSheet?: () => void
  onOpenSettings?: () => void
  onChangeLedSize?: (value: number) => void
  onChangeStyle?: (value: number) => void
}
