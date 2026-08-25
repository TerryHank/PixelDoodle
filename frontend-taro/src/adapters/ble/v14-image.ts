import { rgbToRgb565 } from '@/utils/ble-packet'

export function decodeRgb565(value: number): [number, number, number] {
  if (value === 0x0001) {
    return [0, 0, 0]
  }
  return [
    Math.round(((value >> 11) & 0x1f) * 255 / 31),
    Math.round(((value >> 5) & 0x3f) * 255 / 63),
    Math.round((value & 0x1f) * 255 / 31)
  ]
}

export function normalizeRgb565Color(color: [number, number, number]) {
  return decodeRgb565(rgbToRgb565(color))
}

export function rgb565PayloadToRgb888(
  payload: Uint8Array,
  targetWidth: number,
  targetHeight: number
) {
  const sourcePixels = payload.length / 2
  const sourceSize = Math.sqrt(sourcePixels)
  if (!Number.isInteger(sourceSize)) {
    throw new Error('待发送图案不是有效的方形 RGB565 数据')
  }

  const output = new Uint8Array(targetWidth * targetHeight * 3)
  for (let row = 0; row < targetHeight; row += 1) {
    const sourceRow = Math.min(sourceSize - 1, Math.floor(row * sourceSize / targetHeight))
    for (let column = 0; column < targetWidth; column += 1) {
      const sourceColumn = Math.min(
        sourceSize - 1,
        Math.floor(column * sourceSize / targetWidth)
      )
      const sourceOffset = (sourceRow * sourceSize + sourceColumn) * 2
      const value = payload[sourceOffset] | (payload[sourceOffset + 1] << 8)
      const outputOffset = (row * targetWidth + column) * 3
      output.set(decodeRgb565(value), outputOffset)
    }
  }
  return output
}

export function getV14HighlightPoints(
  image: Uint8Array,
  width: number,
  height: number,
  color: [number, number, number]
) {
  const points: Array<{ column: number; row: number }> = []
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 3
      if (
        image[offset] === color[0] &&
        image[offset + 1] === color[1] &&
        image[offset + 2] === color[2]
      ) {
        points.push({ column, row })
      }
    }
  }
  return points
}
