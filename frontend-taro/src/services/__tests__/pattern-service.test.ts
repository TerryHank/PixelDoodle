import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/taro', () => ({
  default: {
    ENV_TYPE: {
      WEB: 'WEB',
      WEAPP: 'WEAPP',
      RN: 'RN'
    },
    getEnv: () => 'WEB'
  }
}))

import { buildGenerateFields, exportPattern } from '../pattern-service'

describe('pattern service', () => {
  it('serializes generate options', () => {
    const fields = buildGenerateFields({
      gridWidth: 48,
      gridHeight: 48,
      palettePreset: '221'
    })

    expect(fields.grid_width).toBe('48')
    expect(fields.grid_height).toBe('48')
    expect(fields.palette_preset).toBe('221')
  })

  it('uses fetch for h5 export requests', async () => {
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(arrayBuffer, {
          status: 200
        })
      )

    const result = await exportPattern('json', { foo: 'bar' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/export/json',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3]))

    fetchMock.mockRestore()
  })

  it('throws service errors from h5 export responses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: 'export failed' }), {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    await expect(exportPattern('json', { foo: 'bar' })).rejects.toThrow(
      'export failed'
    )

    fetchMock.mockRestore()
  })
})
