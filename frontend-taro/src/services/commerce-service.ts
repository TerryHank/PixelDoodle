import Taro from '@tarojs/taro'
import { getPrivateApiHeaders } from './identity'
import { requestJson } from './http'
import { getApiBaseUrl } from './env'
import type {
  CommerceConfig,
  CommerceDevice,
  DeviceAccessGrant,
  EarningsResponse,
  PaymentOrder,
  SettlementBatch
} from '@/types/commerce'

function privateHeaders(userId: string, includeJson = false) {
  return {
    ...getPrivateApiHeaders(userId),
    ...(includeJson ? { 'content-type': 'application/json' } : {})
  }
}

export function createCommerceIdempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function getCommerceConfig() {
  return requestJson<CommerceConfig>('/api/commerce/config')
}

export function listOwnedCommerceDevices(userId: string) {
  return requestJson<{ items: CommerceDevice[] }>('/api/commerce/devices', {
    header: privateHeaders(userId)
  })
}

export function sandboxRegisterCommerceDevice(
  userId: string,
  payload: {
    device_id: string
    display_name?: string
    session_price_cents?: number
  }
) {
  return requestJson<CommerceDevice>('/api/commerce/devices/sandbox-register', {
    method: 'POST',
    header: privateHeaders(userId, true),
    data: payload
  })
}

export function createPaymentOrder(
  userId: string,
  deviceId: string,
  idempotencyKey = createCommerceIdempotencyKey('order')
) {
  return requestJson<PaymentOrder>('/api/commerce/orders', {
    method: 'POST',
    header: privateHeaders(userId, true),
    data: {
      device_id: deviceId,
      idempotency_key: idempotencyKey
    }
  })
}

export function listPaymentOrders(userId: string) {
  return requestJson<{ items: PaymentOrder[] }>('/api/commerce/orders', {
    header: privateHeaders(userId)
  })
}

export function getPaymentOrder(userId: string, orderId: string) {
  return requestJson<PaymentOrder>(
    `/api/commerce/orders/${encodeURIComponent(orderId)}`,
    { header: privateHeaders(userId) }
  )
}

export function sandboxPayOrder(userId: string, orderId: string) {
  return requestJson<{ order: PaymentOrder; idempotent: boolean }>(
    `/api/commerce/orders/${encodeURIComponent(orderId)}/sandbox-pay`,
    {
      method: 'POST',
      header: privateHeaders(userId)
    }
  )
}

export function issueDeviceAccessGrant(userId: string, orderId: string) {
  return requestJson<DeviceAccessGrant>(
    `/api/commerce/orders/${encodeURIComponent(orderId)}/device-grant`,
    {
      method: 'POST',
      header: privateHeaders(userId)
    }
  )
}

export function recordDeviceActivation(
  userId: string,
  deviceId: string,
  accessToken: string
) {
  return requestJson<DeviceAccessGrant>('/api/commerce/device-activations', {
    method: 'POST',
    header: privateHeaders(userId, true),
    data: {
      device_id: deviceId,
      access_token: accessToken
    }
  })
}

export function listEarnings(userId: string) {
  return requestJson<EarningsResponse>('/api/commerce/earnings', {
    header: privateHeaders(userId)
  })
}

export async function fetchEarningsCsv(userId: string) {
  const response = await Taro.request<ArrayBuffer>({
    url: `${getApiBaseUrl()}/api/commerce/earnings/export.csv`,
    method: 'GET',
    header: privateHeaders(userId),
    responseType: 'arraybuffer'
  })
  if (response.statusCode >= 400) {
    throw new Error(`收益导出失败（HTTP ${response.statusCode}）`)
  }
  return response.data
}

export function createSettlement(
  userId: string,
  idempotencyKey = createCommerceIdempotencyKey('settlement')
) {
  return requestJson<SettlementBatch>('/api/commerce/settlements', {
    method: 'POST',
    header: privateHeaders(userId, true),
    data: {
      idempotency_key: idempotencyKey,
      currency: 'CNY'
    }
  })
}
