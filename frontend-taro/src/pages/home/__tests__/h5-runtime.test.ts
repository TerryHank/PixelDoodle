import { describe, expect, it } from 'vitest'

import { deriveH5HomeViewState, getBleConnectedToastMessage } from '../h5-runtime'

describe('deriveH5HomeViewState', () => {
  it('shows the scan guide when no target device is locked', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: null,
        bleConnectedUuid: null,
        isBleReady: false,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      showUploadArea: true,
      showExamples: true,
      showCanvas: false,
      showColorPanel: false,
      uploadAreaMode: 'scan',
      uploadAreaText: '先扫描设备二维码进行配对',
      uploadAreaHint: '已配对后可继续上传图片；也可在设置中切换 WiFi 模式',
      toolbarChipText: ''
    })
  })

  it('shows the locked prompt when a device uuid is present but not connected', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: 'ABCD',
        bleConnectedUuid: null,
        isBleReady: false,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      uploadAreaMode: 'locked',
      uploadAreaText: '点击连接已锁定设备 ABCD',
      uploadAreaHint: '已锁定设备后，点击继续完成蓝牙连接',
      toolbarChipText: 'ABCD'
    })
  })

  it('shows the upload prompt when the locked ble device is connected', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: 'ABCD',
        bleConnectedUuid: 'ABCD',
        isBleReady: true,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      uploadAreaMode: 'upload',
      uploadAreaText: '点击上传图片',
      uploadAreaHint: '支持 JPG、PNG、GIF、WebP',
      toolbarChipText: 'ABCD'
    })
  })

  it('keeps the locked state when the connected uuid does not match the target', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: 'ABCD',
        bleConnectedUuid: 'WXYZ',
        isBleReady: true,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      uploadAreaMode: 'locked',
      toolbarChipText: 'ABCD'
    })
  })

  it('does not enter upload mode when ble is ready but the connected uuid is missing', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: 'ABCD',
        bleConnectedUuid: null,
        isBleReady: true,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      uploadAreaMode: 'locked',
      toolbarChipText: 'ABCD'
    })
  })

  it('does not enter upload mode when ble is not ready even if uuids match', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: 'ABCD',
        bleConnectedUuid: 'ABCD',
        isBleReady: false,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      uploadAreaMode: 'locked',
      toolbarChipText: 'ABCD'
    })
  })

  it('uses the actual connected uuid in the success toast instead of the locked target uuid', () => {
    expect(
      getBleConnectedToastMessage({
        targetDeviceUuid: 'ABCD1234EF56',
        bleConnectedUuid: 'DCBA1234ABCD'
      })
    ).toBe('蓝牙已连接 DCBA1234ABCD')
  })
})
