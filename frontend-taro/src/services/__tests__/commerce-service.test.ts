import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  getPrivateApiHeaders: vi.fn(() => ({
    'x-pixeldoodle-user-id': 'user-a'
  }))
}))

vi.mock('@tarojs/taro', () => ({ default: { request: vi.fn() } }))
vi.mock('../http', () => ({ requestJson: mocks.requestJson }))
vi.mock('../identity', () => ({ getPrivateApiHeaders: mocks.getPrivateApiHeaders }))

import {
  createPaymentOrder,
  issueDeviceAccessGrant,
  listEarnings,
  sandboxPayOrder
} from '../commerce-service'

describe('commerce service', () => {
  beforeEach(() => mocks.requestJson.mockReset())

  it('does not let the client choose the order price or merchant', async () => {
    mocks.requestJson.mockResolvedValue({})

    await createPaymentOrder('user-a', 'A1B2C3D4E5F6', 'order-key')

    expect(mocks.requestJson).toHaveBeenCalledWith(
      '/api/commerce/orders',
      expect.objectContaining({
        method: 'POST',
        data: {
          device_id: 'A1B2C3D4E5F6',
          idempotency_key: 'order-key'
        },
        header: expect.objectContaining({
          'x-pixeldoodle-user-id': 'user-a'
        })
      })
    )
  })

  it('uses the authenticated payment, grant, and earnings endpoints', async () => {
    mocks.requestJson.mockResolvedValue({})

    await sandboxPayOrder('user-a', 'order/1')
    await issueDeviceAccessGrant('user-a', 'order/1')
    await listEarnings('user-a')

    expect(mocks.requestJson.mock.calls.map((call) => call[0])).toEqual([
      '/api/commerce/orders/order%2F1/sandbox-pay',
      '/api/commerce/orders/order%2F1/device-grant',
      '/api/commerce/earnings'
    ])
  })
})
