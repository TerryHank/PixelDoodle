import { describe, expect, it } from 'vitest'
import { buildHomeViewModel } from '../view-model'

describe('buildHomeViewModel', () => {
  it('shows the scan guide before a target uuid is locked', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: ''
    })

    expect(vm.showUploadGuide).toBe(true)
    expect(vm.uploadAreaMode).toBe('scan')
    expect(vm.uploadAreaIcon).toBe('QR')
    expect(vm.uploadAreaText).toBe('先扫描设备二维码进行配对')
    expect(vm.toolbarChipText).toBe('')
  })

  it('shows the locked-device prompt after a uuid has been locked', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: 'F42DC97179B4'
    })

    expect(vm.showDeviceChip).toBe(true)
    expect(vm.showUploadGuide).toBe(true)
    expect(vm.uploadAreaMode).toBe('locked')
    expect(vm.uploadAreaText).toBe('点击连接已锁定设备 F42DC97179B4')
    expect(vm.uploadAreaHint).toBe('已锁定设备后，点击继续完成蓝牙连接')
    expect(vm.toolbarChipText).toBe('F42DC97179B4')
  })

  it('switches to upload mode after the locked ble target becomes ready', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: 'F42DC97179B4',
      bleConnectionStatus: 'connected',
      bleCharacteristicStatus: 'ready',
      connectionMode: 'ble'
    })

    expect(vm.uploadAreaMode).toBe('upload')
    expect(vm.uploadAreaIcon).toBe('+')
    expect(vm.uploadAreaText).toBe('点击上传图片')
    expect(vm.uploadAreaHint).toBe('支持 JPG、PNG、GIF、WebP')
  })

  it('allows upload mode for the currently registered wifi target', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: 'F42DC97179B4',
      connectionMode: 'wifi',
      registeredWifiDevice: {
        device_uuid: 'F42DC97179B4',
        ip: '192.168.1.55',
        updated_at: 1
      }
    })

    expect(vm.uploadAreaMode).toBe('upload')
  })

  it('keeps the locked prompt when the registered wifi device does not match', () => {
    const vm = buildHomeViewModel({
      pixelMatrix: [],
      targetDeviceUuid: 'F42DC97179B4',
      connectionMode: 'wifi',
      registeredWifiDevice: {
        device_uuid: 'AAAAAAAAAAAA',
        ip: '192.168.1.55',
        updated_at: 1
      }
    })

    expect(vm.uploadAreaMode).toBe('locked')
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
