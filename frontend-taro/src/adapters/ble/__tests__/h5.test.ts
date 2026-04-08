import { afterEach, describe, expect, it, vi } from 'vitest'

function createCharacteristic() {
  return {
    startNotifications: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn()
  }
}

function createBleDevice(name: string) {
  const imageCharacteristic = createCharacteristic()
  const wifiCharacteristic = createCharacteristic()

  return {
    id: `${name}-id`,
    name,
    gatt: {
      connected: false,
      connect: vi.fn().mockImplementation(async () => {
        const server = {
          getPrimaryService: vi.fn().mockResolvedValue({
            getCharacteristic: vi
              .fn()
              .mockResolvedValueOnce(imageCharacteristic)
              .mockResolvedValueOnce(wifiCharacteristic)
          })
        }

        return server
      })
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('h5BleAdapter.connectTargetDevice', () => {
  it('returns the actual connected uuid when exact match falls back to another BeadCraft device', async () => {
    const targetUuid = 'ABCD1234EF56'
    const actualUuid = 'DCBA1234ABCD'
    const requestDevice = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NotFoundError' }))
      .mockResolvedValueOnce(createBleDevice(`BeadCraft-${actualUuid}`))

    vi.stubGlobal('navigator', {
      bluetooth: {
        requestDevice
      }
    })

    const { h5BleAdapter } = await import('../h5')

    await expect(h5BleAdapter.connectTargetDevice(targetUuid)).resolves.toBe(actualUuid)
    expect(requestDevice).toHaveBeenCalledTimes(2)
  })
})

describe('h5BleAdapter.getAuthorizedDevices', () => {
  it('returns authorized BeadCraft devices and filters unrelated devices', async () => {
    vi.stubGlobal('navigator', {
      bluetooth: {
        getDevices: vi.fn().mockResolvedValue([
          createBleDevice('BeadCraft-ABCD1234EF56'),
          createBleDevice('Keyboard-1234')
        ]),
        requestDevice: vi.fn()
      }
    })

    const { h5BleAdapter } = await import('../h5')

    await expect(h5BleAdapter.getAuthorizedDevices?.()).resolves.toEqual([
      {
        key: 'BeadCraft-ABCD1234EF56-id',
        name: 'BeadCraft-ABCD1234EF56',
        uuid: 'ABCD1234EF56'
      }
    ])
  })
})

describe('h5BleAdapter.connectKnownDevice', () => {
  it('connects an authorized device without reopening the browser picker', async () => {
    const authorizedDevice = createBleDevice('BeadCraft-ABCD1234EF56')
    const requestDevice = vi.fn()
    const getDevices = vi.fn().mockResolvedValue([authorizedDevice])

    vi.stubGlobal('navigator', {
      bluetooth: {
        getDevices,
        requestDevice
      }
    })

    const { h5BleAdapter } = await import('../h5')

    await expect(
      h5BleAdapter.connectKnownDevice?.('BeadCraft-ABCD1234EF56-id')
    ).resolves.toBe('ABCD1234EF56')
    expect(requestDevice).not.toHaveBeenCalled()
    expect(getDevices).toHaveBeenCalledTimes(1)
    expect(authorizedDevice.gatt.connect).toHaveBeenCalledTimes(1)
  })
})
