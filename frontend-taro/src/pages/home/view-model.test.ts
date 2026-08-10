import { describe, expect, it } from 'vitest'

import { buildHomeViewModel } from './view-model'

describe('home view model', () => {
  it('keeps upload enabled before bluetooth is connected', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: '',
      colorSummaryCount: 0,
      env: 'h5'
    })

    expect(vm.uploadAreaMode).toBe('upload')
    expect(vm.uploadAreaText).toBe('点击上传图片')
    expect(vm.uploadAreaHint).toContain('20MB')
    expect(vm.showExampleGallery).toBe(true)
  })
})
