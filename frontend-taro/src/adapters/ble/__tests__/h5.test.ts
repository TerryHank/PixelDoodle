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

describe('h5BleAdapter.readStatus', () => {
  it('separates the brightness status notification from image ACKs', async () => {
    let notificationHandler: ((event: Event) => void) | undefined
    const imageCharacteristic = {
      startNotifications: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn((_name: string, handler: (event: Event) => void) => {
        notificationHandler = handler
      }),
      writeValueWithoutResponse: vi.fn().mockImplementation(async () => {
        const bytes = Uint8Array.from([0x26, 72])
        notificationHandler?.({
          target: {
            value: new DataView(bytes.buffer)
          }
        } as unknown as Event)
      })
    }
    const wifiCharacteristic = createCharacteristic()
    const device = createBleDevice('BeadCraft-ABCD1234EF56')
    device.gatt.connect.mockImplementation(async () => {
      device.gatt.connected = true
      return {
        getPrimaryService: vi.fn().mockResolvedValue({
          getCharacteristic: vi
            .fn()
            .mockResolvedValueOnce(imageCharacteristic)
            .mockResolvedValueOnce(wifiCharacteristic)
        })
      }
    })

    vi.stubGlobal('navigator', {
      bluetooth: {
        requestDevice: vi.fn().mockResolvedValue(device)
      }
    })

    const { h5BleAdapter } = await import('../h5')
    await h5BleAdapter.connectTargetDevice('ABCD1234EF56')

    await expect(h5BleAdapter.readStatus?.()).resolves.toEqual({ brightness: 72 })
    expect(imageCharacteristic.writeValueWithoutResponse).toHaveBeenCalledWith(
      Uint8Array.from([0x0A])
    )
  })
})
