import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BLE_CHARACTERISTIC_UUID,
  BLE_PREFERRED_MTU,
  BLE_SERVICE_UUID,
  BLE_WIFI_SCAN_CHARACTERISTIC_UUID
} from '@/constants/ble'
import { BEAD_SCREEN_BLE_V1_4 } from '@/protocols/bead-screen-ble-v1_4'

const mocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getAdapterState: vi.fn(),
  getMtu: vi.fn(),
  send: vi.fn(),
  setAndroidMtu: vi.fn(),
  setWriteBehavior: vi.fn(),
  startScan: vi.fn(),
  subscribe: vi.fn(),
  handlers: new Map<string, (data: number[]) => void>()
}))

vi.mock('@mnlphlp/plugin-blec', () => ({
  checkPermissions: mocks.checkPermissions,
  connect: mocks.connect,
  disconnect: mocks.disconnect,
  getAdapterState: mocks.getAdapterState,
  getMtu: mocks.getMtu,
  send: mocks.send,
  setAndroidMtu: mocks.setAndroidMtu,
  setWriteBehavior: mocks.setWriteBehavior,
  startScan: mocks.startScan,
  subscribe: mocks.subscribe
}))

const beadCraftDevice = {
  address: 'AA:BB:CC:DD:EE:FF',
  name: 'BeadCraft-ABCD1234EF56',
  rssi: -42,
  isConnected: false,
  isBonded: false,
  services: [BLE_SERVICE_UUID],
  manufacturerData: {},
  serviceData: {}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.handlers.clear()
  mocks.checkPermissions.mockResolvedValue(true)
  mocks.getAdapterState.mockResolvedValue('On')
  mocks.getMtu.mockResolvedValue(BLE_PREFERRED_MTU)
  mocks.connect.mockResolvedValue(undefined)
  mocks.disconnect.mockResolvedValue(undefined)
  mocks.setAndroidMtu.mockResolvedValue(undefined)
  mocks.setWriteBehavior.mockResolvedValue(undefined)
  mocks.subscribe.mockImplementation(
    async (characteristic: string, _service: string, handler: (data: number[]) => void) => {
      mocks.handlers.set(characteristic, handler)
    }
  )
  mocks.startScan.mockImplementation(async (handler: (devices: unknown[]) => void) => {
    handler([
      {
        ...beadCraftDevice,
        address: '11:22:33:44:55:66',
        name: 'Keyboard-1234'
      },
      beadCraftDevice
    ])
  })
  mocks.send.mockImplementation(
    async (characteristic: string, data: number[]) => {
      const handler = mocks.handlers.get(characteristic)
      if (data[0] === 0x0a) {
        handler?.([0x26, 72])
      } else if (data[0] === 0x03) {
        handler?.([0x06])
      }
    }
  )
})

describe('tauriBleAdapter', () => {
  it('scans only BeadCraft devices and connects through native BLE', async () => {
    const { tauriBleAdapter } = await import('../tauri')

    await expect(tauriBleAdapter.scanNearbyDevices?.()).resolves.toEqual([
      {
        key: beadCraftDevice.address,
        name: beadCraftDevice.name,
        uuid: 'ABCD1234EF56'
      }
    ])
    await expect(
      tauriBleAdapter.connectTargetDevice('ABCD1234EF56')
    ).resolves.toBe('ABCD1234EF56')

    expect(mocks.setAndroidMtu).toHaveBeenCalledWith(BLE_PREFERRED_MTU)
    expect(mocks.connect).toHaveBeenCalledWith(
      beadCraftDevice.address,
      expect.any(Function)
    )
    expect(mocks.subscribe).toHaveBeenCalledWith(
      BLE_CHARACTERISTIC_UUID,
      BLE_SERVICE_UUID,
      expect.any(Function)
    )
    expect(mocks.subscribe).toHaveBeenCalledWith(
      BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
      BLE_SERVICE_UUID,
      expect.any(Function)
    )
  })

  it('routes status and image ACK notifications without a Web Bluetooth API', async () => {
    const { tauriBleAdapter } = await import('../tauri')
    await tauriBleAdapter.connectTargetDevice('ABCD1234EF56')

    await expect(tauriBleAdapter.readStatus?.()).resolves.toEqual({ brightness: 72 })
    await expect(
      tauriBleAdapter.sendImage(Uint8Array.from([1, 2, 3, 4]))
    ).resolves.toBeUndefined()

    expect(mocks.send).toHaveBeenCalledWith(
      BLE_CHARACTERISTIC_UUID,
      [0x0a],
      'withoutResponse',
      BLE_SERVICE_UUID
    )
    expect(mocks.send).toHaveBeenCalledWith(
      BLE_CHARACTERISTIC_UUID,
      expect.arrayContaining([0x03]),
      'withoutResponse',
      BLE_SERVICE_UUID
    )
  })

  it('connects PDD V1.4 and reads the hardware-info brightness response', async () => {
    const pddDevice = {
      ...beadCraftDevice,
      address: 'AD:FF:3D:CB:72:4E',
      name: 'PDD_CB724E',
      services: [BEAD_SCREEN_BLE_V1_4.serviceUuid]
    }
    mocks.startScan.mockImplementation(async (handler: (devices: unknown[]) => void) => {
      handler([pddDevice])
    })
    mocks.send.mockImplementation(
      async (characteristic: string, data: number[], _mode: string, service: string) => {
        if (
          characteristic === BEAD_SCREEN_BLE_V1_4.writeUuid &&
          service === BEAD_SCREEN_BLE_V1_4.serviceUuid &&
          data[2] === 0x01 &&
          data[3] === 0x80
        ) {
          mocks.handlers.get(BEAD_SCREEN_BLE_V1_4.notifyUuid)?.([
            8, 0, 1, 128, 3, 0, 0, 25
          ])
        }
      }
    )

    const { tauriBleAdapter } = await import('../tauri')
    await expect(tauriBleAdapter.connectTargetDevice()).resolves.toBe('CB724E')
    await expect(tauriBleAdapter.readStatus?.()).resolves.toEqual({
      brightness: 25,
      boardWidth: 104,
      boardHeight: 104,
      rotationDegrees: 0,
      passwordFlag: 0
    })
    expect(mocks.subscribe).toHaveBeenCalledWith(
      BEAD_SCREEN_BLE_V1_4.notifyUuid,
      BEAD_SCREEN_BLE_V1_4.serviceUuid,
      expect.any(Function)
    )
    expect(mocks.subscribe).not.toHaveBeenCalledWith(
      BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
      BLE_SERVICE_UUID,
      expect.any(Function)
    )
  })

  it('stops before scanning when nearby-device permission is denied', async () => {
    mocks.checkPermissions.mockResolvedValue(false)
    const { tauriBleAdapter } = await import('../tauri')

    await expect(tauriBleAdapter.scanNearbyDevices?.()).rejects.toThrow(
      '未获得附近设备权限'
    )
    expect(mocks.startScan).not.toHaveBeenCalled()
  })
})
