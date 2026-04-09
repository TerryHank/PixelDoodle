import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openBluetoothAdapterMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const onBLECharacteristicValueChangeMock = vi.hoisted(() => vi.fn())
const onBluetoothDeviceFoundMock = vi.hoisted(() => vi.fn())
const startBluetoothDevicesDiscoveryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const stopBluetoothDevicesDiscoveryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const getBluetoothDevicesMock = vi.hoisted(() => vi.fn())
const createBLEConnectionMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const getBLEDeviceServicesMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    services: [
      {
        uuid: '4FAFC201-1FB5-459E-8FCC-C5C9C331914B'
      }
    ]
  })
)
const getBLEDeviceCharacteristicsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    characteristics: [
      {
        uuid: 'BEB5483E-36E1-4688-B7F5-EA0734B3E6C1',
        properties: {
          write: true,
          writeDefault: true,
          writeNoResponse: true
        }
      },
      {
        uuid: '9F6B2A1D-6A52-4F4E-93C7-8D9C6D41E7A1'
      }
    ]
  })
)
const notifyBLECharacteristicValueChangeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const writeBLECharacteristicValueMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const setBLEMTUMock = vi.hoisted(() => vi.fn().mockResolvedValue({ mtu: 247 }))
const getBLEMTUMock = vi.hoisted(() => vi.fn().mockResolvedValue({ mtu: 247 }))
const getSystemInfoSyncMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    platform: 'android'
  })
)

vi.mock('@tarojs/taro', () => ({
  default: {
    openBluetoothAdapter: openBluetoothAdapterMock,
    onBLECharacteristicValueChange: onBLECharacteristicValueChangeMock,
    onBluetoothDeviceFound: onBluetoothDeviceFoundMock,
    startBluetoothDevicesDiscovery: startBluetoothDevicesDiscoveryMock,
    stopBluetoothDevicesDiscovery: stopBluetoothDevicesDiscoveryMock,
    getBluetoothDevices: getBluetoothDevicesMock,
    createBLEConnection: createBLEConnectionMock,
    getBLEDeviceServices: getBLEDeviceServicesMock,
    getBLEDeviceCharacteristics: getBLEDeviceCharacteristicsMock,
    notifyBLECharacteristicValueChange: notifyBLECharacteristicValueChangeMock,
    writeBLECharacteristicValue: writeBLECharacteristicValueMock,
    setBLEMTU: setBLEMTUMock,
    getBLEMTU: getBLEMTUMock,
    getSystemInfoSync: getSystemInfoSyncMock
  }
}))

function createNearbyDevice(name: string, deviceId: string, rssi = -45) {
  return {
    name,
    localName: name,
    deviceId,
    RSSI: rssi
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('weappBleAdapter.scanNearbyDevices', () => {
  it('discovers nearby BeadCraft devices without restricting the scan to advertised services', async () => {
    getBluetoothDevicesMock
      .mockResolvedValueOnce({
        devices: [
          createNearbyDevice('Keyboard-1234', 'ignored-device', -20),
          createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -55)
        ]
      })
      .mockResolvedValueOnce({
        devices: [
          createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45),
          createNearbyDevice('BeadCraft-DCBA6543ABCD', 'beadcraft-2', -60)
        ]
      })

    const { weappBleAdapter } = await import('../weapp')
    const scanPromise = weappBleAdapter.scanNearbyDevices?.()
    await vi.runAllTimersAsync()

    await expect(scanPromise).resolves.toEqual([
      {
        key: 'beadcraft-1',
        name: 'BeadCraft-ABCD1234EF56',
        uuid: 'ABCD1234EF56'
      },
      {
        key: 'beadcraft-2',
        name: 'BeadCraft-DCBA6543ABCD',
        uuid: 'DCBA6543ABCD'
      }
    ])

    expect(startBluetoothDevicesDiscoveryMock).toHaveBeenCalledWith({
      allowDuplicatesKey: false
    })
  })
})

describe('weappBleAdapter.connectKnownDevice', () => {
  it('connects a selected scanned device by deviceId', async () => {
    getBluetoothDevicesMock
      .mockResolvedValueOnce({
        devices: [createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45)]
      })
      .mockResolvedValueOnce({
        devices: [createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45)]
      })

    const { weappBleAdapter } = await import('../weapp')
    const scanPromise = weappBleAdapter.scanNearbyDevices?.()
    await vi.runAllTimersAsync()
    await scanPromise

    const connectPromise = weappBleAdapter.connectKnownDevice?.('beadcraft-1')
    await vi.runAllTimersAsync()

    await expect(connectPromise).resolves.toBe('ABCD1234EF56')
    expect(createBLEConnectionMock).toHaveBeenCalledWith({
      deviceId: 'beadcraft-1'
    })
    expect(setBLEMTUMock).toHaveBeenCalledWith({
      deviceId: 'beadcraft-1',
      mtu: 247
    })
    expect(getBLEMTUMock).toHaveBeenCalledWith({
      deviceId: 'beadcraft-1',
      writeType: 'writeNoResponse'
    })
    expect(getBLEDeviceServicesMock).toHaveBeenCalledWith({
      deviceId: 'beadcraft-1'
    })
    expect(getBLEDeviceCharacteristicsMock).toHaveBeenCalledWith({
      deviceId: 'beadcraft-1',
      serviceId: '4FAFC201-1FB5-459E-8FCC-C5C9C331914B'
    })
    expect(notifyBLECharacteristicValueChangeMock).toHaveBeenCalledTimes(2)
  })

  it('still connects when the firmware only exposes the image characteristic', async () => {
    getBluetoothDevicesMock
      .mockResolvedValueOnce({
        devices: [createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45)]
      })
      .mockResolvedValueOnce({
        devices: [createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45)]
      })
    getBLEDeviceCharacteristicsMock.mockResolvedValueOnce({
      characteristics: [
        {
          uuid: 'BEB5483E-36E1-4688-B7F5-EA0734B3E6C1'
        }
      ]
    })

    const { weappBleAdapter } = await import('../weapp')
    const scanPromise = weappBleAdapter.scanNearbyDevices?.()
    await vi.runAllTimersAsync()
    await scanPromise

    const connectPromise = weappBleAdapter.connectKnownDevice?.('beadcraft-1')
    await vi.runAllTimersAsync()

    await expect(connectPromise).resolves.toBe('ABCD1234EF56')
    expect(notifyBLECharacteristicValueChangeMock).toHaveBeenCalledTimes(1)
    expect(notifyBLECharacteristicValueChangeMock).toHaveBeenCalledWith({
      deviceId: 'beadcraft-1',
      serviceId: '4FAFC201-1FB5-459E-8FCC-C5C9C331914B',
      characteristicId: 'BEB5483E-36E1-4688-B7F5-EA0734B3E6C1',
      state: true
    })
  })
})

describe('weappBleAdapter.sendImage', () => {
  it('uses the negotiated MTU to reduce BLE packet count', async () => {
    getBluetoothDevicesMock
      .mockResolvedValueOnce({
        devices: [createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45)]
      })
      .mockResolvedValueOnce({
        devices: [createNearbyDevice('BeadCraft-ABCD1234EF56', 'beadcraft-1', -45)]
      })

    const { weappBleAdapter } = await import('../weapp')
    const scanPromise = weappBleAdapter.scanNearbyDevices?.()
    await vi.runAllTimersAsync()
    await scanPromise

    const connectPromise = weappBleAdapter.connectKnownDevice?.('beadcraft-1')
    await vi.runAllTimersAsync()
    await connectPromise

    writeBLECharacteristicValueMock.mockClear()

    await weappBleAdapter.sendImage?.(new Uint8Array(500))

    expect(writeBLECharacteristicValueMock).toHaveBeenCalledTimes(5)
    expect(writeBLECharacteristicValueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        writeType: 'writeNoResponse'
      })
    )
  })
})
