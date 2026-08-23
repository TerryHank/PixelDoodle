export interface CommerceConfig {
  payment_provider: string | null
  sandbox_payment: boolean
  auto_settle: boolean
  grant_duration_seconds: number
}

export interface CommerceDevice {
  device_id: string
  merchant_account_id: string
  display_name: string
  session_price_cents: number
  currency: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export type PaymentOrderStatus =
  | 'creating'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded'

export interface PaymentOrder {
  id: string
  user_id: string
  device_id: string
  merchant_account_id: string
  amount_cents: number
  currency: string
  status: PaymentOrderStatus
  provider: string
  provider_order_id: string | null
  checkout_url: string | null
  checkout: {
    qr_payload?: string
  }
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  expires_at: string
  paid_at: string | null
}

export interface DeviceAccessGrant {
  grant_id: string
  order_id: string
  device_id: string
  access_token: string
  duration_seconds: number
  not_after_epoch: number
  grant_sequence: number
  delivery_expires_at: string
  access_expires_at: string
  activated_at: string | null
  idempotent: boolean
}

export interface EarningItem {
  allocation_id: string
  order_id: string
  account_id: string
  role: string
  gross_cents: number
  share_cents: number
  currency: string
  basis_points: number
  status: 'available' | 'processing' | 'settled'
  created_at: string
  settlement_batch_id: string | null
}

export interface EarningsResponse {
  items: EarningItem[]
  summary: Record<
    string,
    {
      available_cents: number
      processing_cents: number
      settled_cents: number
      total_cents: number
    }
  >
  total: number
}

export interface SettlementBatch {
  id: string
  account_id: string
  currency: string
  provider: string
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  amount_cents: number
  item_count: number
  provider_reference: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}
