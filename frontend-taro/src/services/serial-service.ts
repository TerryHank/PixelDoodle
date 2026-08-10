import type { PixelMatrix } from '@/types/api'
import { requestJson } from './http'

export interface SerialPortInfo {
  device: string
  description: string
  hwid: string
}

export interface SerialPortsResponse {
  ports: SerialPortInfo[]
}

export interface SerialSendRequest {
  pixel_matrix: PixelMatrix
  port: string
  baud_rate: number
  background_color: [number, number, number]
  led_matrix_size: string
}

export interface SerialSendResponse {
  success?: boolean
  bytes_sent?: number
  duration_ms?: number
}

export interface SerialHighlightRequest {
  highlight_colors: [number, number, number][]
  port: string
}

export interface SerialHighlightResponse {
  success?: boolean
}

export async function listSerialPorts() {
  return requestJson<SerialPortsResponse>('/api/serial/ports')
}

export async function sendSerialImage(payload: SerialSendRequest) {
  return requestJson<SerialSendResponse>('/api/serial/send', {
    method: 'POST',
    data: payload
  })
}

export async function sendSerialHighlight(payload: SerialHighlightRequest) {
  return requestJson<SerialHighlightResponse>('/api/serial/highlight', {
    method: 'POST',
    data: payload
  })
}
