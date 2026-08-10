import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@tarojs/taro', () => ({
  default: {
    request: requestMock
  }
}))

import { requestJson } from '../http'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.stubEnv('TARO_APP_API_BASE_URL', 'https://api.example.com')
  vi.stubEnv('TARO_ENV', 'weapp')
})

describe('requestJson', () => {
  it('prepends the configured base url', async () => {
    requestMock.mockResolvedValue({
      data: { ok: true },
      statusCode: 200
    })

    await requestJson('/v1/pattern')

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/v1/pattern'
      })
    )
  })

  it('passes through method header and data', async () => {
    requestMock.mockResolvedValue({
      data: { ok: true },
      statusCode: 200
    })

    await requestJson('/v1/pattern', {
      method: 'POST',
      header: {
        'content-type': 'application/json',
        'x-request-id': 'abc123'
      },
      data: {
        foo: 'bar'
      }
    })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        header: {
          'content-type': 'application/json',
          'x-request-id': 'abc123'
        },
        data: {
          foo: 'bar'
        }
      })
    )
  })

  it('throws when the status code is 400 or above', async () => {
    requestMock.mockResolvedValue({
      data: { detail: 'not found' },
      statusCode: 404
    })

    await expect(requestJson('/v1/missing')).rejects.toThrow('not found')
  })

  it('throws when the response body marks success false', async () => {
    requestMock.mockResolvedValue({
      data: {
        success: false,
        message: 'request rejected'
      },
      statusCode: 200
    })

    await expect(requestJson('/v1/rejected')).rejects.toThrow('request rejected')
  })
})
