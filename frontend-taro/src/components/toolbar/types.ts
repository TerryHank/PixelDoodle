export interface ToolbarProps {
  targetDeviceUuid?: string
  removeBackground?: boolean
  difficultyLabel: string
  ledSizeLabel: string
  modeQuickLabel: string
  modeQuickConnected?: boolean
  difficultyValue?: string
  ledSizeValue?: number
  onToggleBackground?: () => void
  onClear?: () => void
  onPickImage?: () => void
  onOpenPairSheet?: () => void
  onOpenSettings?: () => void
  onChangeDifficulty?: (value: string) => void
  onChangeLedSize?: (value: number) => void
}
