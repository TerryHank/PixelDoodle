import { describe, expect, it } from 'vitest'
import { buildHomeViewModel } from '../view-model'

describe('buildHomeViewModel', () => {
  it('keeps upload enabled before a device is connected', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: '',
      colorSummaryCount: 0,
      env: 'h5'
    })

    expect(vm.showUploadGuide).toBe(true)
    expect(vm.uploadAreaMode).toBe('upload')
    expect(vm.uploadAreaIcon).toBe('+')
    expect(vm.uploadAreaText).toBe('点击上传图片')
    expect(vm.uploadAreaHint).toContain('20MB')
  })

  it('keeps device identity as optional toolbar context', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: 'F42DC97179B4'
    })

    expect(vm.showDeviceChip).toBe(true)
    expect(vm.uploadAreaMode).toBe('upload')
    expect(vm.toolbarChipText).toBe('F42DC97179B4')
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
