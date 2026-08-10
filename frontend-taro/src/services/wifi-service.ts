import type {
  WifiHighlightRequest,
  WifiHighlightResponse,
  WifiRegisterRequest,
  WifiRegisterResponse,
  WifiSendRequest,
  WifiSendResponse
} from '@/types/api'
import { requestJson } from './http'

export async function registerWifiDevice(payload: WifiRegisterRequest) {
  return requestJson<WifiRegisterResponse>('/api/wifi/register', {
    method: 'POST',
    data: payload
  })
}

export async function sendWifiImage(payload: WifiSendRequest) {
  return requestJson<WifiSendResponse>('/api/wifi/send', {
    method: 'POST',
    data: payload
  })
}

export async function sendWifiHighlight(payload: WifiHighlightRequest) {
  return requestJson<WifiHighlightResponse>('/api/wifi/highlight', {
    method: 'POST',
    data: payload
  })
}
