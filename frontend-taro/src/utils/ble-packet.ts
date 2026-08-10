import {
  BLE_IMAGE_CANVAS_SIZE,
  BLE_IMAGE_PAYLOAD_BYTES
} from '@/constants/ble'
import type { PaletteColor, PixelMatrix } from '@/types/api'
import type { WifiScanResult } from '../types/device'

const RGB565_BLACK = 0x0000
const RGB565_TRANSPARENT_MARKER = 0x0001

export function splitBlePayload(payload: Uint8Array, chunkSize: number) {
  const chunks: Uint8Array[] = []

  for (let index = 0; index < payload.length; index += chunkSize) {
    chunks.push(payload.slice(index, index + chunkSize))
  }

  return chunks
}

export function checksum16(payload: Uint8Array) {
  let sum = 0

  for (let index = 0; index < payload.length; index += 1) {
    sum = (sum + payload[index]) & 0xffff
  }

  return sum
}

export function rgbToRgb565(rgb: [number, number, number]) {
  const [red, green, blue] = rgb
  const r5 = (red >> 3) & 0x1f
  const g6 = (green >> 2) & 0x3f
  const b5 = (blue >> 3) & 0x1f

  return (r5 << 11) | (g6 << 5) | b5
}

export function buildImagePackets(payload: Uint8Array, chunkSize: number) {
  const packets: Uint8Array[] = [Uint8Array.from([0x01])]

  splitBlePayload(payload, chunkSize).forEach((chunk) => {
    const packet = new Uint8Array(chunk.length + 1)
    packet[0] = 0x02
    packet.set(chunk, 1)
    packets.push(packet)
  })

  const checksum = checksum16(payload)
  packets.push(Uint8Array.from([0x03, checksum & 0xff, (checksum >> 8) & 0xff]))

  return packets
}

export function buildHighlightPacket(colors: Array<[number, number, number]>) {
  if (!colors.length) {
    return Uint8Array.from([0x05])
  }

  const packet = new Uint8Array(2 + colors.length * 2)
  packet[0] = 0x04
  packet[1] = colors.length

  colors.forEach((rgb, index) => {
    const rgb565 = rgbToRgb565(rgb)
    const base = 2 + index * 2
    packet[base] = rgb565 & 0xff
    packet[base + 1] = (rgb565 >> 8) & 0xff
  })

  return packet
}

export function encodeUtf8(input: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input)
  }

  const encoded = encodeURIComponent(input).replace(
    /%([0-9A-F]{2})/gi,
    (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
  )

  return Uint8Array.from(
    encoded.split('').map((character) => character.charCodeAt(0))
  )
}

export function decodeUtf8(bytes: Uint8Array) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes)
  }

  const binary = Array.from(bytes, (value) =>
    `%${value.toString(16).padStart(2, '0')}`
  ).join('')

  try {
    return decodeURIComponent(binary)
  } catch {
    return String.fromCharCode(...bytes)
  }
}

export function buildWifiConnectPacket(ssid: string, password = '') {
  const ssidBytes = encodeUtf8(ssid)
  const passwordBytes = encodeUtf8(password)

  if (ssidBytes.length > 255 || passwordBytes.length > 255) {
    throw new Error('WiFi 名称或密码过长，无法下发到设备')
  }

  const packet = new Uint8Array(3 + ssidBytes.length + passwordBytes.length)
  packet[0] = 0x08
  packet[1] = ssidBytes.length
  packet[2] = passwordBytes.length
  packet.set(ssidBytes, 3)
  packet.set(passwordBytes, 3 + ssidBytes.length)

  return packet
}

function normalizeWifiScanItem(value: unknown): WifiScanResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Partial<
    WifiScanResult & {
      secured?: boolean
    }
  >

  const ssid = String(item.ssid || '').trim()
  const rssiValue =
    typeof item.rssi === 'number'
      ? item.rssi
      : Number.parseInt(String(item.rssi ?? ''), 10)

  return {
    ssid: ssid || '(Hidden SSID)',
    rssi: Number.isFinite(rssiValue) ? rssiValue : 0,
    secure:
      typeof item.secure === 'boolean'
        ? item.secure
        : Boolean(item.secured),
    bssid: item.bssid,
    channel: item.channel,
    ip: item.ip
  }
}

export function parseWifiScanResult(raw: string): WifiScanResult[] {
  const trimmed = raw.trim()

  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const items = Array.isArray(parsed) ? parsed : [parsed]

      return items
        .map(normalizeWifiScanItem)
        .filter((item): item is WifiScanResult => Boolean(item))
        .sort((left, right) => (right.rssi ?? 0) - (left.rssi ?? 0))
    } catch {
      // Fallback to legacy tab-separated text below.
    }
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ssid = '', rssi = '', secure = '0'] = line.split('\t')

      return {
        ssid: ssid || '(Hidden SSID)',
        rssi: Number.parseInt(rssi, 10) || 0,
        secure: secure === '1'
      }
    })
    .sort((left, right) => (right.rssi ?? 0) - (left.rssi ?? 0))
}

function resamplePixelMatrix(pixelMatrix: PixelMatrix, targetSize: number) {
  if (!pixelMatrix.length || !pixelMatrix[0]?.length) {
    return Array.from({ length: targetSize }, () =>
      Array.from({ length: targetSize }, () => null)
    ) as PixelMatrix
  }

  const sourceHeight = pixelMatrix.length
  const sourceWidth = pixelMatrix[0].length

  if (sourceHeight === targetSize && sourceWidth === targetSize) {
    return pixelMatrix.map((row) => [...row])
  }

  const output: PixelMatrix = []

  for (let y = 0; y < targetSize; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((y * sourceHeight) / targetSize)
    )
    const row = []

    for (let x = 0; x < targetSize; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((x * sourceWidth) / targetSize)
      )
      row.push(pixelMatrix[sourceY][sourceX] ?? null)
    }

    output.push(row)
  }

  return output
}

export function scaleAndCenterPixelMatrix(
  pixelMatrix: PixelMatrix,
  targetSize: number,
  canvasSize = BLE_IMAGE_CANVAS_SIZE
) {
  const scaledSize = Math.max(1, Math.min(targetSize || canvasSize, canvasSize))
  const scaled = resamplePixelMatrix(pixelMatrix, scaledSize)
  const canvas = Array.from({ length: canvasSize }, () =>
    Array.from({ length: canvasSize }, () => null)
  ) as PixelMatrix

  const offsetY = Math.floor((canvasSize - scaled.length) / 2)
  const offsetX = Math.floor((canvasSize - (scaled[0]?.length || 0)) / 2)

  for (let y = 0; y < scaled.length; y += 1) {
    for (let x = 0; x < scaled[y].length; x += 1) {
      canvas[offsetY + y][offsetX + x] = scaled[y][x]
    }
  }

  return canvas
}

export function pixelMatrixToRgb565Bytes(
  pixelMatrix: PixelMatrix,
  palette: Record<string, PaletteColor>,
  backgroundColor: [number, number, number] = [0, 0, 0]
) {
  const bytes = new Uint8Array(BLE_IMAGE_PAYLOAD_BYTES)
  const backgroundRgb565 = rgbToRgb565(backgroundColor)
  const backgroundFillRgb565 =
    backgroundRgb565 === RGB565_BLACK
      ? RGB565_TRANSPARENT_MARKER
      : backgroundRgb565

  for (let offset = 0; offset < bytes.length; offset += 2) {
    bytes[offset] = backgroundFillRgb565 & 0xff
    bytes[offset + 1] = (backgroundFillRgb565 >> 8) & 0xff
  }

  let offset = 0
  for (const row of pixelMatrix) {
    for (const code of row) {
      const colorInfo = code ? palette[code] : null
      let rgb565 = backgroundFillRgb565

      if (code !== null) {
        const rgb =
          colorInfo?.rgb ||
          (code ? ([255, 255, 255] as [number, number, number]) : backgroundColor)
        rgb565 = rgbToRgb565(rgb)
      }

      bytes[offset] = rgb565 & 0xff
      bytes[offset + 1] = (rgb565 >> 8) & 0xff
      offset += 2

      if (offset >= bytes.length) {
        return bytes
      }
    }
  }

  return bytes
}
