import type { WifiScanResult } from '../types/device'

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

export function parseWifiScanResult(raw: string): WifiScanResult[] {
  return raw
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
