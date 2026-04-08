import { beforeEach, describe, expect, it } from 'vitest'

import { useDeviceStore } from './device-store'

describe('device store highlight selection', () => {
  beforeEach(() => {
    useDeviceStore.setState({
      activeHighlightCodes: []
    })
  })

  it('keeps only one active code at a time', () => {
    expect(useDeviceStore.getState().toggleHighlightCode('A1')).toEqual(['A1'])
    expect(useDeviceStore.getState().toggleHighlightCode('B2')).toEqual(['B2'])
  })

  it('clears the selection when the same code is tapped twice', () => {
    useDeviceStore.getState().toggleHighlightCode('A1')
    expect(useDeviceStore.getState().toggleHighlightCode('A1')).toEqual([])
  })
})
