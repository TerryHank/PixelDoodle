import { describe, expect, it } from 'vitest'
import {
  deriveH5HomeViewState,
  getBleConnectedToastMessage,
  restoreBleConnectedUuid,
  selectAuthorizedDeviceForReconnect
} from '../h5-runtime'

describe('deriveH5HomeViewState', () => {
  it.each([
    { targetDeviceUuid: null, bleConnectedUuid: null, isBleReady: false },
    { targetDeviceUuid: 'ABCD', bleConnectedUuid: null, isBleReady: false },
    { targetDeviceUuid: 'ABCD', bleConnectedUuid: 'ABCD', isBleReady: true },
    { targetDeviceUuid: 'ABCD', bleConnectedUuid: 'WXYZ', isBleReady: true }
  ])('keeps web creation available independently from device state', (deviceState) => {
    expect(
      deriveH5HomeViewState({
        ...deviceState,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      showUploadArea: true,
      showExamples: true,
      showCanvas: false,
      showColorPanel: false,
      uploadAreaMode: 'upload',
      uploadAreaText: '点击上传图片'
    })
  })

  it('shows the editor after a pattern has been created', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: null,
        bleConnectedUuid: null,
        isBleReady: false,
        hasPattern: true,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      showUploadArea: false,
      showExamples: false,
      showCanvas: true,
      showColorPanel: true
    })
  })

  it('uses the actual connected uuid in the success toast', () => {
    expect(
      getBleConnectedToastMessage({
        targetDeviceUuid: 'ABCD1234EF56',
        bleConnectedUuid: 'DCBA1234ABCD'
      })
    ).toBe('蓝牙已连接 DCBA1234ABCD')
  })

  it('restores the connected uuid after the editor page remounts', () => {
    expect(
      restoreBleConnectedUuid({
        targetDeviceUuid: ' cb724e ',
        connectionStatus: 'connected',
        characteristicStatus: 'ready'
      })
    ).toBe('CB724E')
  })

  it('does not restore a stale device when the bluetooth session is not ready', () => {
    expect(
      restoreBleConnectedUuid({
        targetDeviceUuid: 'CB724E',
        connectionStatus: 'connected',
        characteristicStatus: 'discovering'
      })
    ).toBeNull()
  })

  it('reconnects the remembered authorized device when multiple devices exist', () => {
    const devices = [
      { uuid: 'AAAA', key: 'one' },
      { uuid: 'CB724E', key: 'two' }
    ]
    expect(selectAuthorizedDeviceForReconnect(devices, ' cb724e ')).toEqual(devices[1])
  })

  it('reconnects the only authorized device without a remembered uuid', () => {
    const device = { uuid: 'CB724E', key: 'only' }
    expect(selectAuthorizedDeviceForReconnect([device], null)).toEqual(device)
    expect(selectAuthorizedDeviceForReconnect([device, { uuid: 'AAAA', key: 'two' }], null)).toBeNull()
  })
})
