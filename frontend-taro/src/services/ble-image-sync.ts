import type { PaletteColor, PixelMatrix } from '@/types/api'
import type {
  DeviceCharacteristicStatus,
  DeviceConnectionStatus
} from '@/types/device'
import {
  pixelMatrixToRgb565Bytes,
  scaleAndCenterPixelMatrix
} from '@/utils/ble-packet'

interface AutoSendGeneratedPatternInput {
  bleConnectionStatus: DeviceConnectionStatus
  bleCharacteristicStatus: DeviceCharacteristicStatus
  isSending: boolean
  ledSize: number
  pixelMatrix: PixelMatrix
  palette: Record<string, PaletteColor>
  backgroundColor?: [number, number, number]
  sendImage: (payload: Uint8Array) => Promise<void>
}

function hasGeneratedPattern(pixelMatrix: PixelMatrix) {
  return pixelMatrix.some((row) => row.some((cell) => cell != null))
}

export async function autoSendGeneratedPattern(
  input: AutoSendGeneratedPatternInput
) {
  if (
    input.bleConnectionStatus !== 'connected' ||
    input.bleCharacteristicStatus !== 'ready' ||
    input.isSending ||
    !hasGeneratedPattern(input.pixelMatrix)
  ) {
    return false
  }

  const mappedMatrix = scaleAndCenterPixelMatrix(input.pixelMatrix, input.ledSize)
  const payload = pixelMatrixToRgb565Bytes(
    mappedMatrix,
    input.palette,
    input.backgroundColor ?? [0, 0, 0]
  )

  await input.sendImage(payload)
  return true
}
