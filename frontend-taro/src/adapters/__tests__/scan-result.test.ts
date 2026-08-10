import { describe, expect, it } from 'vitest'
import { extractUuidFromScanResult } from '../scan/h5'

describe('extractUuidFromScanResult', () => {
  it('extracts uuid from qr url', () => {
    expect(extractUuidFromScanResult('https://host/?u=F42DC97179B4')).toBe('F42DC97179B4')
  })
})
