import { describe, expect, it } from 'vitest'

import { exportPatternLocally } from './local-export'

const payload = {
  pixel_matrix: [
    ['A1', null],
    ['B1', 'A1']
  ],
  color_data: {
    A1: '#FFFFFF',
    B1: '#000000'
  },
  color_summary: [
    { code: 'A1', name_zh: '白色', hex: '#FFFFFF', count: 2 },
    { code: 'B1', hex: '#000000', count: 1 }
  ]
}

describe('local export', () => {
  it('creates a valid PNG signature in the frontend', async () => {
    const bytes = new Uint8Array(await exportPatternLocally('png', payload))
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(new TextDecoder().decode(bytes.slice(-12))).toContain('IEND')
  })

  it('creates a self-contained PDF in the frontend', async () => {
    const bytes = new Uint8Array(await exportPatternLocally('pdf', payload))
    const text = new TextDecoder().decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
  })

  it('keeps the original JSON export structure', async () => {
    const bytes = await exportPatternLocally('json', payload)
    const data = JSON.parse(new TextDecoder().decode(bytes))
    expect(data.version).toBe('1.0')
    expect(data.dimensions).toEqual({ width: 2, height: 2 })
    expect(data.pixel_matrix).toEqual(payload.pixel_matrix)
    expect(data.color_summary[0].name_zh).toBe('白色')
  })
})
