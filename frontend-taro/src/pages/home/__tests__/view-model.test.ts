import { describe, expect, it } from 'vitest'
import { buildHomeViewModel } from '../view-model'

describe('buildHomeViewModel', () => {
  it('shows upload guide before image generation', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: ''
    })

    expect(vm.showUploadGuide).toBe(true)
  })

  it('shows the device chip after a uuid has been locked', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [['A1']],
      targetDeviceUuid: 'F42DC97179B4',
      colorSummaryCount: 1
    })

    expect(vm.showDeviceChip).toBe(true)
    expect(vm.showUploadGuide).toBe(false)
    expect(vm.showColorPanel).toBe(true)
  })

  it('shows the RN capability hint when running in RN', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: '',
      env: 'rn'
    })

    expect(vm.showRnCapabilityHint).toBe(true)
  })
})
