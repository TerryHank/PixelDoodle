import { isUuidLike, normalizeUuid } from '@/utils/uuid'
import type { ScanAdapter } from './types'

export function extractUuidFromScanResult(input: string) {
  const raw = input.trim()

  if (!raw) {
    return ''
  }

  if (isUuidLike(raw)) {
    return normalizeUuid(raw)
  }

  try {
    const normalized = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(normalized)
    return normalizeUuid(
      url.searchParams.get('u') || url.searchParams.get('device_uuid') || ''
    )
  } catch {
    const match = raw.match(/([0-9A-F]{12})/i)
    return match ? normalizeUuid(match[1]) : ''
  }
}

export const h5ScanAdapter: ScanAdapter = {
  async scanDevice() {
    throw new Error('H5 扫码能力稍后接入，可先手输 UUID')
  }
}
